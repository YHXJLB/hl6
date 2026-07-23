package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os/signal"
	"strings"
	"syscall"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"hl6-server/internal/config"
	"hl6-server/internal/model"
	"hl6-server/internal/referral"
	"hl6-server/internal/router"
)

const internalSessionSecretKey = "_internal_session_secret"
const (
	referralCodeBackfillMaxRetries       = 20
	migrationAdvisoryLockKey       int64 = 19490333
)

func main() {
	godotenv.Load("../.env")

	cfg := config.Load()

	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		log.Fatal("failed to connect database:", err)
	}

	if err := runSchemaMigrations(db); err != nil {
		log.Fatal("failed to migrate:", err)
	}

	log.Println("Database migrated successfully")

	// GIN index for JSONB target_ids queries
	db.Exec("CREATE INDEX IF NOT EXISTS idx_notifications_target_ids ON notifications USING GIN (target_ids)")

	migrateCreditsToInt(db)
	seedDefaults(db)
	bootstrapSessionSecret(db, cfg)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	r := router.Setup(cfg, db, ctx)
	if err := router.RunServer(cfg, r); err != nil {
		log.Fatal("server shutdown error:", err)
	}
}

func bootstrapSessionSecret(db *gorm.DB, cfg *config.Config) {
	seed := strings.TrimSpace(cfg.SessionSecret)
	secret, source, err := resolveSessionSecret(db, seed)
	if err != nil {
		log.Fatal("failed to bootstrap session secret:", err)
	}
	if seed != "" && source == "database" && seed != secret {
		log.Println("SESSION_SECRET env is ignored because database session secret already exists")
	}
	cfg.SessionSecret = secret
	log.Printf("Session secret loaded from %s", source)
}

func resolveSessionSecret(db *gorm.DB, seed string) (string, string, error) {
	existing, err := getSystemConfigValue(db, internalSessionSecretKey)
	if err == nil {
		if existing == "" {
			return "", "", errors.New("stored session secret is empty")
		}
		return existing, "database", nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", "", err
	}

	secret := seed
	source := "generated random secret"
	if secret == "" {
		generated, genErr := generateHexSecret(32)
		if genErr != nil {
			return "", "", genErr
		}
		secret = generated
	} else {
		source = "SESSION_SECRET env seed"
	}

	createErr := db.Create(&model.SystemConfig{
		Key:   internalSessionSecretKey,
		Value: secret,
	}).Error
	if createErr == nil {
		return secret, source, nil
	}

	// If another instance raced to create the row, read the existing value.
	existing, readErr := getSystemConfigValue(db, internalSessionSecretKey)
	if readErr != nil {
		return "", "", fmt.Errorf("failed to save session secret: %w (fallback read failed: %v)", createErr, readErr)
	}
	if existing == "" {
		return "", "", errors.New("stored session secret is empty")
	}
	return existing, "database", nil
}

func getSystemConfigValue(db *gorm.DB, key string) (string, error) {
	var cfg model.SystemConfig
	if err := db.Where("\"key\" = ?", key).First(&cfg).Error; err != nil {
		return "", err
	}
	return strings.TrimSpace(cfg.Value), nil
}

func generateHexSecret(byteLen int) (string, error) {
	b := make([]byte, byteLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func verifyRequiredTables(db *gorm.DB, tables []interface{}) error {
	for _, table := range tables {
		if !db.Migrator().HasTable(table) {
			return fmt.Errorf("missing table for %T", table)
		}
	}
	return nil
}

func runSchemaMigrations(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", migrationAdvisoryLockKey).Error; err != nil {
			return fmt.Errorf("acquire migration advisory lock: %w", err)
		}

		if err := preMigrateDNSLegacyObjects(tx); err != nil {
			return err
		}

		// Rename logto_id column to external_id (idempotent)
		var colExists bool
		if err := tx.Raw("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'logto_id')").Scan(&colExists).Error; err != nil {
			return err
		}
		if colExists {
			if err := tx.Exec("ALTER TABLE users RENAME COLUMN logto_id TO external_id").Error; err != nil {
				return fmt.Errorf("rename logto_id column: %w", err)
			}
			log.Println("Renamed column users.logto_id → external_id")
		}

		if err := dedupeAuditExemptionPendings(tx); err != nil {
			return err
		}
		if err := tx.AutoMigrate(
			&model.User{},
			&model.UserGroup{},
			&model.DNSProviderAccount{},
			&model.Domain{},
			&model.DomainGroupAccess{},
			&model.Subdomain{},
			&model.DNSRecord{},
			&model.AuditRule{},
			&model.AuditExemptionPending{},
			&model.SubdomainScan{},
			&model.DNSOperationRequest{},
			&model.DNSOperationEvent{},
			&model.DNSBulkJob{},
			&model.DNSBulkJobItem{},
			&model.DomainDNSMigrationTask{},
			&model.DomainDNSMigrationItem{},
			&model.CreditBalance{},
			&model.CreditTransaction{},
			&model.DailyCheckinClaim{},
			&model.AuditLog{},
			&model.SystemConfig{},
			&model.Notification{},
			&model.NotificationRead{},
			&model.NotificationImage{},
			&model.BrandingAsset{},
			&model.UserReferral{},
			&model.RedeemCode{},
			&model.RedeemCodeRedemption{},
		); err != nil {
			return err
		}
		if err := migrateDNSProviderFields(tx); err != nil {
			return err
		}
		if err := cleanupLegacyDNSSyncSchema(tx); err != nil {
			return err
		}
		if err := ensureDNSRecordConstraints(tx); err != nil {
			return err
		}
		if err := ensureMigrationConstraints(tx); err != nil {
			return err
		}
		if err := migrateDNSProviderAccountStatus(tx); err != nil {
			return err
		}
		if err := backfillAuditStatusFields(tx); err != nil {
			return err
		}
		if err := ensureAuditIndexes(tx); err != nil {
			return err
		}
		if err := ensureAuditSchema(tx); err != nil {
			return err
		}

		if err := verifyRequiredTables(tx, []interface{}{
			&model.User{},
			&model.UserGroup{},
			&model.SystemConfig{},
		}); err != nil {
			return err
		}
		return nil
	})
}

func ensureMigrationConstraints(db *gorm.DB) error {
	statements := []string{
		// Ensure only one running migration per domain at a time
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_one_running_per_domain ON domain_dns_migration_tasks (domain_id) WHERE status = 'running'`,
		// Index for worker to pick up pending tasks efficiently
		`CREATE INDEX IF NOT EXISTS idx_migration_tasks_status_domain ON domain_dns_migration_tasks (status, domain_id)`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("ensure migration constraint (%s): %w", stmt, err)
		}
	}
	return nil
}

func migrateDNSProviderAccountStatus(db *gorm.DB) error {
	// Set default status for existing accounts that have no status
	return db.Exec(`UPDATE dns_provider_accounts SET status = 'active' WHERE status IS NULL OR status = ''`).Error
}

func backfillAuditStatusFields(db *gorm.DB) error {
	statements := []string{
		`UPDATE subdomains SET status = 'active' WHERE status IS NULL OR status = ''`,
		`UPDATE dns_records SET status = 'active' WHERE status IS NULL OR status = ''`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("backfill audit status (%s): %w", stmt, err)
		}
	}
	return nil
}

// dedupeAuditExemptionPendings 清理 audit_exemption_pendings 表中 (subdomain_id, rule_id) 的重复行，
// 只保留每个组合中 id 最大的记录。此迁移必须在 unique index 创建前执行。
func dedupeAuditExemptionPendings(db *gorm.DB) error {
	// 全新数据库上此表尚未由 AutoMigrate 创建，无需去重（否则 DELETE 会因表不存在而中断整个迁移）。
	if !db.Migrator().HasTable("audit_exemption_pendings") {
		return nil
	}
	return db.Exec(`
		DELETE FROM audit_exemption_pendings a
		USING audit_exemption_pendings b
		WHERE a.subdomain_id = b.subdomain_id
		  AND a.rule_id = b.rule_id
		  AND a.id < b.id
	`).Error
}

func ensureAuditSchema(db *gorm.DB) error {
	statements := []string{
		`ALTER TABLE audit_rules ALTER COLUMN action TYPE varchar(16)`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("ensure audit schema (%s): %w", stmt, err)
		}
	}
	return nil
}

func ensureAuditIndexes(db *gorm.DB) error {
	statements := []string{
		`CREATE INDEX IF NOT EXISTS idx_subdomain_scans_subdomain_created ON subdomain_scans (subdomain_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_subdomain_scans_lookup ON subdomain_scans (subdomain_id, status, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_exemption_claim ON audit_exemption_pendings (status, recheck_at)`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("ensure audit index (%s): %w", stmt, err)
		}
	}
	return nil
}

func ensureDNSRecordConstraints(db *gorm.DB) error {
	statements := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_dns_records_subdomain_type_content_unique ON dns_records (subdomain_id, type, content)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_dns_records_subdomain_cname_unique ON dns_records (subdomain_id) WHERE type = 'CNAME'`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("ensure dns record constraint (%s): %w", stmt, err)
		}
	}
	return nil
}

func preMigrateDNSLegacyObjects(db *gorm.DB) error {
	if err := renameTableIfExists(db, "cloudflare_accounts", "dns_provider_accounts"); err != nil {
		return err
	}
	if err := renameColumnIfExists(db, "dns_records", "cloudflare_record_id", "provider_record_id"); err != nil {
		return err
	}
	if err := renameColumnIfExists(db, "domains", "cloudflare_zone_id", "provider_zone_id"); err != nil {
		return err
	}
	if err := renameColumnIfExists(db, "domains", "cloudflare_account_id", "provider_account_id"); err != nil {
		return err
	}
	return nil
}

func migrateDNSProviderFields(db *gorm.DB) error {
	statements := []string{
		`ALTER TABLE IF EXISTS domains ADD COLUMN IF NOT EXISTS provider varchar(32)`,
		`UPDATE domains SET provider = 'cloudflare' WHERE provider IS NULL OR provider = ''`,
		`ALTER TABLE IF EXISTS dns_provider_accounts ADD COLUMN IF NOT EXISTS provider varchar(32)`,
		`ALTER TABLE IF EXISTS dns_provider_accounts ADD COLUMN IF NOT EXISTS credentials text`,
		`UPDATE dns_provider_accounts SET provider = 'cloudflare' WHERE provider IS NULL OR provider = ''`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("migrate dns provider fields (%s): %w", stmt, err)
		}
	}
	if db.Migrator().HasTable("dns_provider_accounts") && db.Migrator().HasColumn("dns_provider_accounts", "api_token") {
		stmt := `UPDATE dns_provider_accounts SET credentials = api_token WHERE (credentials IS NULL OR credentials = '') AND api_token IS NOT NULL`
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("migrate dns provider credentials from legacy api_token (%s): %w", stmt, err)
		}
	}
	return nil
}

func cleanupLegacyDNSSyncSchema(db *gorm.DB) error {
	statements := []string{
		`ALTER TABLE IF EXISTS dns_records DROP COLUMN IF EXISTS sync_status`,
		`ALTER TABLE IF EXISTS dns_records DROP COLUMN IF EXISTS sync_operation_id`,
		`ALTER TABLE IF EXISTS dns_records DROP COLUMN IF EXISTS sync_error`,
		`ALTER TABLE IF EXISTS dns_provider_accounts DROP COLUMN IF EXISTS api_token`,
		`DROP TABLE IF EXISTS cloudflare_tasks`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("cleanup legacy dns sync schema (%s): %w", stmt, err)
		}
	}
	return nil
}

func renameTableIfExists(db *gorm.DB, oldName, newName string) error {
	if !db.Migrator().HasTable(oldName) || db.Migrator().HasTable(newName) {
		return nil
	}
	if err := db.Migrator().RenameTable(oldName, newName); err != nil {
		return fmt.Errorf("rename table %s -> %s: %w", oldName, newName, err)
	}
	return nil
}

func renameColumnIfExists(db *gorm.DB, table, oldName, newName string) error {
	if !db.Migrator().HasTable(table) || !db.Migrator().HasColumn(table, oldName) || db.Migrator().HasColumn(table, newName) {
		return nil
	}
	if err := db.Migrator().RenameColumn(table, oldName, newName); err != nil {
		return fmt.Errorf("rename column %s.%s -> %s: %w", table, oldName, newName, err)
	}
	return nil
}

func seedDefaults(db *gorm.DB) {
	// 1. Ensure a default user group exists
	var groupCount int64
	db.Model(&model.UserGroup{}).Count(&groupCount)
	if groupCount == 0 {
		db.Create(&model.UserGroup{Name: "Default", IsDefault: true})
	}

	// 2. Assign all users without a group to the default group
	var defaultGroup model.UserGroup
	if err := db.Where("is_default = ?", true).First(&defaultGroup).Error; err == nil {
		db.Model(&model.User{}).Where("group_id IS NULL").Update("group_id", defaultGroup.ID)
	}

	// 3. Migrate Domain.CreditCost to DomainGroupAccess for default group
	if defaultGroup.ID > 0 {
		var domains []model.Domain
		db.Find(&domains)
		for _, d := range domains {
			var existing int64
			db.Model(&model.DomainGroupAccess{}).Where("domain_id = ?", d.ID).Count(&existing)
			if existing == 0 {
				db.Create(&model.DomainGroupAccess{
					DomainID:   d.ID,
					GroupID:    defaultGroup.ID,
					CreditCost: d.CreditCost,
				})
			}
		}
	}

	// 4. Seed config defaults
	configDefaults := map[string]string{
		"registration_bonus_credits": "0",
		"referral_enabled":           "true",
		"referral_inviter_credits":   "0",
		"referral_invitee_credits":   "0",
		"daily_checkin_enabled":      "false",
		"daily_checkin_credits":      "0",
		"daily_checkin_group_ids":    "",
	}
	for key, defaultVal := range configDefaults {
		var rc model.SystemConfig
		if db.Where("\"key\" = ?", key).First(&rc).Error != nil {
			db.Create(&model.SystemConfig{Key: key, Value: defaultVal})
		}
	}

	// 5. Backfill referral_code for existing users
	var usersWithoutCode []model.User
	db.Where("referral_code = '' OR referral_code IS NULL").Find(&usersWithoutCode)
	for _, u := range usersWithoutCode {
		if err := backfillReferralCode(db, u.ID); err != nil {
			log.Printf("failed to backfill referral_code for user %d: %v", u.ID, err)
		}
	}
}

func migrateCreditsToInt(db *gorm.DB) {
	// Check if migration already done
	var cfg model.SystemConfig
	if db.Where("\"key\" = ?", "credits_migrated_to_int").First(&cfg).Error == nil {
		return // already migrated
	}

	// Check if tables exist and columns are float type
	var colType string
	row := db.Raw("SELECT data_type FROM information_schema.columns WHERE table_name = 'credit_balances' AND column_name = 'balance'").Row()
	if row == nil {
		return // table doesn't exist yet
	}
	if err := row.Scan(&colType); err != nil {
		return // table doesn't exist yet
	}
	if colType == "bigint" {
		// Already int type, just mark as done
		db.Create(&model.SystemConfig{Key: "credits_migrated_to_int", Value: "1"})
		return
	}

	log.Println("Migrating credit columns from float to integer...")

	// Convert float values to int (multiply by 10)
	db.Exec("UPDATE credit_balances SET balance = ROUND(balance * 10)")
	db.Exec("ALTER TABLE credit_balances ALTER COLUMN balance TYPE bigint USING balance::bigint")

	db.Exec("UPDATE credit_transactions SET amount = ROUND(amount * 10), balance_after = ROUND(balance_after * 10)")
	db.Exec("ALTER TABLE credit_transactions ALTER COLUMN amount TYPE bigint USING amount::bigint")
	db.Exec("ALTER TABLE credit_transactions ALTER COLUMN balance_after TYPE bigint USING balance_after::bigint")

	db.Exec("UPDATE domain_group_accesses SET credit_cost = ROUND(credit_cost * 10)")
	db.Exec("ALTER TABLE domain_group_accesses ALTER COLUMN credit_cost TYPE bigint USING credit_cost::bigint")

	db.Exec("UPDATE domains SET credit_cost = ROUND(credit_cost * 10)")
	db.Exec("ALTER TABLE domains ALTER COLUMN credit_cost TYPE bigint USING credit_cost::bigint")

	db.Create(&model.SystemConfig{Key: "credits_migrated_to_int", Value: "1"})
	log.Println("Credit migration complete")
}

func backfillReferralCode(db *gorm.DB, userID uint) error {
	for attempts := 0; attempts < referralCodeBackfillMaxRetries; attempts++ {
		code, err := referral.GenerateCode(5)
		if err != nil {
			return err
		}
		tx := db.Model(&model.User{}).
			Where("id = ? AND (referral_code = '' OR referral_code IS NULL)", userID).
			Update("referral_code", code)
		if tx.Error != nil {
			if referral.IsCodeUniqueViolation(tx.Error) {
				continue
			}
			return tx.Error
		}
		// rows=0 means this user was concurrently updated by another process.
		if tx.RowsAffected == 0 {
			return nil
		}
		return nil
	}
	return fmt.Errorf("unable to generate unique referral code after %d attempts", referralCodeBackfillMaxRetries)
}

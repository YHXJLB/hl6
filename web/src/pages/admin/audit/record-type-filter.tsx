import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const AUDIT_RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "NS", "MX", "SRV"] as const;
export type AuditRecordType = (typeof AUDIT_RECORD_TYPES)[number];

export function RecordTypeFilter({
  selected,
  onChange,
}: {
  selected: AuditRecordType[];
  onChange: (types: AuditRecordType[]) => void;
}) {
  const { t } = useTranslation();

  const allSelected = selected.length === 0 || selected.length === AUDIT_RECORD_TYPES.length;

  const label = allSelected
    ? t("audit.filters.recordTypeAll")
    : selected.join(", ");

  const toggle = (type: AuditRecordType, checked: boolean) => {
    if (checked) {
      onChange([...new Set([...selected, type])]);
      return;
    }
    onChange(selected.filter((item) => item !== type));
  };

  const selectAll = () => onChange([]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 w-40 shrink-0 justify-between px-3 font-normal">
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-2" align="start">
        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
            <Checkbox checked={allSelected} onCheckedChange={() => selectAll()} />
            <span>{t("audit.filters.recordTypeAll")}</span>
          </label>
          {AUDIT_RECORD_TYPES.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={!allSelected && selected.includes(type)}
                onCheckedChange={(v) => {
                  if (allSelected) {
                    onChange([type]);
                    return;
                  }
                  toggle(type, v === true);
                }}
              />
              <span>{type}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function recordTypeFilterParam(selected: AuditRecordType[]): string | undefined {
  if (selected.length === 0 || selected.length === AUDIT_RECORD_TYPES.length) {
    return undefined;
  }
  return selected.join(",");
}

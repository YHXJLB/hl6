import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, getErrorMessage } from "@/lib/api";
import { cacheBranding } from "@/hooks/use-branding";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CropBox = { x: number; y: number; size: number };
type ImgBounds = { x: number; y: number; w: number; h: number };

function ImageCropDialog({
  imageSrc,
  onConfirm,
  onCancel,
}: {
  imageSrc: string;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgBounds, setImgBounds] = useState<ImgBounds | null>(null);
  const [cropBox, setCropBox] = useState<CropBox | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{
    type: "move" | "resize";
    startX: number;
    startY: number;
    startBox: CropBox;
    bounds: ImgBounds;
  } | null>(null);

  const initCrop = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const nW = img.naturalWidth;
    const nH = img.naturalHeight;
    const scale = Math.min(cW / nW, cH / nH);
    const rW = nW * scale;
    const rH = nH * scale;
    const bx = (cW - rW) / 2;
    const by = (cH - rH) / 2;
    const bounds: ImgBounds = { x: bx, y: by, w: rW, h: rH };
    setImgBounds(bounds);
    setNaturalSize({ w: nW, h: nH });

    const s = Math.min(rW, rH) * 0.8;
    setCropBox({ x: bx + (rW - s) / 2, y: by + (rH - s) / 2, size: s });
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const { x: bx, y: by, w: bw, h: bh } = d.bounds;

    if (d.type === "move") {
      const newX = Math.max(bx, Math.min(bx + bw - d.startBox.size, d.startBox.x + dx));
      const newY = Math.max(by, Math.min(by + bh - d.startBox.size, d.startBox.y + dy));
      setCropBox({ ...d.startBox, x: newX, y: newY });
    } else {
      const delta = (dx + dy) / 2;
      const newSize = Math.max(20, Math.min(Math.min(bw, bh), d.startBox.size + delta));
      const newX = Math.min(d.startBox.x, bx + bw - newSize);
      const newY = Math.min(d.startBox.y, by + bh - newSize);
      setCropBox({ x: newX, y: newY, size: newSize });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const startDrag = (e: React.MouseEvent, type: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    if (!cropBox || !imgBounds) return;
    dragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...cropBox },
      bounds: imgBounds,
    };
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img || !cropBox || !imgBounds) return;

    const scale = img.naturalWidth / imgBounds.w;
    const cx = (cropBox.x - imgBounds.x) * scale;
    const cy = (cropBox.y - imgBounds.y) * scale;
    const cs = cropBox.size * scale;

    const canvas = document.createElement("canvas");
    const size = Math.round(cs);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, cx, cy, cs, cs, 0, 0, size, size);
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, "image/png");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("adminBrand.cropTitle")}</DialogTitle>
        </DialogHeader>
        <div
          ref={containerRef}
          className="relative overflow-hidden bg-muted/30 rounded-md select-none"
          style={{ height: 400 }}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            onLoad={initCrop}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            alt="crop preview"
            draggable={false}
          />
          {cropBox && (
            <div
              className="absolute border-2 border-white cursor-move"
              style={{
                left: cropBox.x,
                top: cropBox.y,
                width: cropBox.size,
                height: cropBox.size,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
              }}
              onMouseDown={(e) => startDrag(e, "move")}
            >
              <div
                className="absolute bottom-2 right-2 w-4 h-4 bg-white cursor-se-resize rounded-sm shadow-[0_0_0_1.5px_rgba(0,0,0,0.55),0_2px_6px_rgba(0,0,0,0.3)]"
                onMouseDown={(e) => startDrag(e, "resize")}
              />
            </div>
          )}
        </div>
        {cropBox && imgBounds && naturalSize && (
          <p className="text-center text-xs text-muted-foreground -mt-1">
            {Math.round(cropBox.size / imgBounds.w * naturalSize.w)} × {Math.round(cropBox.size / imgBounds.h * naturalSize.h)} px
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleConfirm} data-dialog-primary="true">{t("adminBrand.cropConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BrandContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: branding, isLoading } = useQuery({
    queryKey: ["branding-admin"],
    queryFn: async () => {
      const res = await api.getBranding();
      return res.data;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (branding) {
      setName(branding.name);
    }
  }, [branding]);

  const updateNameMutation = useMutation({
    mutationFn: api.adminUpdateBranding,
    onSuccess: (res) => {
      cacheBranding(res.data);
      queryClient.setQueryData(["branding-admin"], res.data);
      toast.success(t("adminBrand.nameSaved"));
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const uploadLogoMutation = useMutation({
    mutationFn: api.adminUploadBrandingLogo,
    onSuccess: (res) => {
      cacheBranding(res.data);
      queryClient.setQueryData(["branding-admin"], res.data);
      toast.success(t("adminBrand.logoUploaded"));
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const deleteLogoMutation = useMutation({
    mutationFn: api.adminDeleteBrandingLogo,
    onSuccess: (res) => {
      cacheBranding(res.data);
      queryClient.setQueryData(["branding-admin"], res.data);
      toast.success(t("adminBrand.logoDeleted"));
      setConfirmDelete(false);
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, t));
      setConfirmDelete(false);
    },
  });

  const canSaveName = name.trim().length > 0 && !updateNameMutation.isPending;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCropSrc(url);
    e.target.value = "";
  };

  const handleCropConfirm = (blob: Blob) => {
    const file = new File([blob], "logo.png", { type: "image/png" });
    uploadLogoMutation.mutate(file);
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("adminBrand.nameLabel")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Skeleton className="h-9 w-full max-w-sm" />
          ) : (
            <>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("adminBrand.namePlaceholder")}
                className="max-w-sm"
              />
              <Button
                onClick={() => updateNameMutation.mutate({ name: name.trim() })}
                disabled={!canSaveName}
              >
                {updateNameMutation.isPending ? t("common.saving") : t("adminBrand.saveName")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("adminBrand.logoLabel")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-6">
            <div className="space-y-2">
              <Label>{t("adminBrand.currentLogo")}</Label>
              <div className="h-14 w-14 rounded-md border bg-muted/20 p-2">
                {branding?.logo_url ? (
                  <img src={branding.logo_url} alt={branding.name} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">-</div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("adminBrand.currentFavicon")}</Label>
              <div className="h-10 w-10 rounded-md border bg-muted/20 p-2">
                {branding?.favicon_url ? (
                  <img src={branding.favicon_url} alt="favicon" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">-</div>
                )}
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex gap-2">
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadLogoMutation.isPending || deleteLogoMutation.isPending}
            >
              {uploadLogoMutation.isPending ? t("common.saving") : t("adminBrand.uploadLogo")}
            </Button>
            {branding?.logo_url && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={uploadLogoMutation.isPending || deleteLogoMutation.isPending}
              >
                {t("adminBrand.deleteLogo")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {cropSrc && (
        <ImageCropDialog
          imageSrc={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}

      <Dialog open={confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("adminBrand.deleteLogoTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("adminBrand.deleteLogoDesc")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteLogoMutation.mutate()}
              disabled={deleteLogoMutation.isPending}
              data-dialog-primary="true"
            >
              {deleteLogoMutation.isPending ? t("common.saving") : t("adminBrand.deleteLogo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

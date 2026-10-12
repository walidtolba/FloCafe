'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Camera, Upload, X, Check, RotateCcw } from 'lucide-react';
import { compressCroppedImageWithPadding, type LogoPadding, type CropArea as CropRect } from '@/lib/image-utils';
import { useImageFileToDataUri } from '@/hooks/useImageFileToDataUri';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';

interface TicketLogoUploaderProps {
  /** Base64 data URI, 'EXISTING' (stored, unchanged), or null (inherit the restaurant logo). */
  value: string | 'EXISTING' | null;
  onChange: (value: string | 'EXISTING' | null) => void;
  /** URL serving the stored ticket logo, shown when value is 'EXISTING'. */
  previewUrl: string;
  /** URL serving the restaurant logo, shown as the fallback preview when value is null. */
  fallbackPreviewUrl: string;
  /** Whether a restaurant logo is actually configured — controls the fallback preview. */
  hasFallbackLogo: boolean;
}

type Mode = 'idle' | 'editing';
type PaddingSide = keyof LogoPadding;

const ASPECT_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '1:1', value: 1 },
  { label: '2:1', value: 2 },
  { label: '3:1', value: 3 },
  { label: '4:1', value: 4 },
];

const PADDING_SIDES: ReadonlyArray<PaddingSide> = ['top', 'right', 'bottom', 'left'];

const PADDING_LABEL_KEYS: Record<PaddingSide, 'ticketLogoPaddingTop' | 'ticketLogoPaddingRight' | 'ticketLogoPaddingBottom' | 'ticketLogoPaddingLeft'> = {
  top: 'ticketLogoPaddingTop',
  right: 'ticketLogoPaddingRight',
  bottom: 'ticketLogoPaddingBottom',
  left: 'ticketLogoPaddingLeft',
};

const ZERO_PADDING: LogoPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Ticket-specific logo upload: free-aspect cropping (preset ratios or a
 * custom W:H) plus four independent padding sliders baked into the saved
 * image — the bottom padding becomes the printed gap before the business
 * name (see main/printers/thermal.ts resolveTicketLogoSetting). Shares the
 * file-intake pipeline with LogoUploader via useImageFileToDataUri, but has
 * its own crop/pad UI since the two editors genuinely diverge there.
 */
export default function TicketLogoUploader({ value, onChange, previewUrl, fallbackPreviewUrl, hasFallbackLogo }: TicketLogoUploaderProps) {
  const t = useTranslations('settings');
  const tProducts = useTranslations('products');
  const [mode, setMode] = useState<Mode>('idle');
  const [editSrc, setEditSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectPreset, setAspectPreset] = useState(2);
  const [customAspect, setCustomAspect] = useState(false);
  const [customW, setCustomW] = useState(2);
  const [customH, setCustomH] = useState(1);
  const [paddingPercent, setPaddingPercent] = useState<LogoPadding>(ZERO_PADDING);
  const [previewDataUri, setPreviewDataUri] = useState<string | null>(null);
  const pixelCropRef = useRef<CropRect | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [cacheBust] = useState(() => Date.now());

  const { getRootProps, getInputProps, isDragActive, cameraInputRef, onCameraChange } = useImageFileToDataUri({
    // Bridges the `products`-namespaced translator to the hook's generic
    // string-key contract — same pattern as PaymentModal's whatsappSendT.
    t: tProducts as (key: string, values?: Record<string, unknown>) => string,
    onLoaded: (dataUri) => {
      setEditSrc(dataUri);
      setMode('editing');
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPaddingPercent(ZERO_PADDING);
      setPreviewDataUri(null);
    },
  });

  const effectiveAspect = customAspect ? Math.max(0.1, customW) / Math.max(0.1, customH) : aspectPreset;

  const paddingFraction: LogoPadding = useMemo(() => ({
    top: paddingPercent.top / 100,
    right: paddingPercent.right / 100,
    bottom: paddingPercent.bottom / 100,
    left: paddingPercent.left / 100,
  }), [paddingPercent]);

  const recomputePreview = useCallback(() => {
    const img = imageRef.current;
    const pixelCrop = pixelCropRef.current;
    if (!img || !pixelCrop) return;
    setPreviewDataUri(compressCroppedImageWithPadding(img, pixelCrop, paddingFraction));
  }, [paddingFraction]);

  const handleCropComplete = useCallback((_area: Area, croppedAreaPixels: Area) => {
    pixelCropRef.current = {
      x: croppedAreaPixels.x,
      y: croppedAreaPixels.y,
      width: croppedAreaPixels.width,
      height: croppedAreaPixels.height,
    };
    recomputePreview();
  }, [recomputePreview]);

  useEffect(() => {
    recomputePreview();
  }, [recomputePreview]);

  useEffect(() => {
    if (!editSrc) {
      imageRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      recomputePreview();
    };
    img.src = editSrc;
    // Only the source image changing should reload it — recomputePreview is
    // re-run separately by its own effect once padding/crop settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSrc]);

  const handleCancelEdit = useCallback(() => {
    setMode('idle');
    setEditSrc(null);
  }, []);

  const handleApply = useCallback(() => {
    const img = imageRef.current;
    const pixelCrop = pixelCropRef.current;
    if (!img || !pixelCrop) return;
    const dataUri = compressCroppedImageWithPadding(img, pixelCrop, paddingFraction);
    if (!dataUri) {
      toast.error(tProducts('imageCompressFailed'));
      return;
    }
    onChange(dataUri);
    setMode('idle');
    setEditSrc(null);
    toast.success(tProducts('imageReady'));
  }, [onChange, paddingFraction, tProducts]);

  const handleRemove = useCallback(() => {
    onChange(null);
    setMode('idle');
    setEditSrc(null);
  }, [onChange]);

  if (mode === 'editing' && editSrc) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-card z-10">
            <h3 className="font-semibold text-foreground">{t('ticketLogoEditTitle')}</h3>
            <button type="button" onClick={handleCancelEdit} className="text-gray-400 hover:text-muted-foreground">
              <X size={20} />
            </button>
          </div>

          <div className="p-4 space-y-5">
            <div>
              <p className="text-sm font-medium text-foreground mb-2">{t('ticketLogoAspectLabel')}</p>
              <div className="flex flex-wrap gap-2">
                {ASPECT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => { setCustomAspect(false); setAspectPreset(preset.value); }}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      !customAspect && aspectPreset === preset.value
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-gray-300 dark:border-border text-muted-foreground hover:border-brand'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomAspect(true)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    customAspect ? 'border-brand bg-brand/10 text-brand' : 'border-gray-300 dark:border-border text-muted-foreground hover:border-brand'
                  }`}
                >
                  {t('ticketLogoAspectCustom')}
                </button>
              </div>
              {customAspect && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min={1}
                    value={customW}
                    onChange={(e) => setCustomW(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 px-2 py-1 border border-gray-300 dark:border-border rounded-lg text-sm bg-background text-foreground"
                  />
                  <span className="text-muted-foreground">:</span>
                  <input
                    type="number"
                    min={1}
                    value={customH}
                    onChange={(e) => setCustomH(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 px-2 py-1 border border-gray-300 dark:border-border rounded-lg text-sm bg-background text-foreground"
                  />
                </div>
              )}
            </div>

            <div className="relative w-full h-64 bg-muted rounded-lg overflow-hidden">
              <Cropper
                image={editSrc}
                crop={crop}
                zoom={zoom}
                aspect={effectiveAspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
            />

            <div>
              <p className="text-sm font-medium text-foreground mb-2">{t('ticketLogoPaddingLabel')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PADDING_SIDES.map((side) => (
                  <label key={side} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="w-14 shrink-0">{t(PADDING_LABEL_KEYS[side])}</span>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={1}
                      value={paddingPercent[side]}
                      onChange={(e) => setPaddingPercent((p) => ({ ...p, [side]: Number(e.target.value) }))}
                      className="flex-1"
                    />
                    <span className="w-10 text-end tabular-nums">{paddingPercent[side]}%</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-2">{t('ticketLogoPreviewLabel')}</p>
              <div className="flex items-center justify-center p-4 bg-white rounded-lg border border-border min-h-[96px]">
                {previewDataUri ? (
                  <img src={previewDataUri} alt="" className="max-h-24 max-w-full" />
                ) : (
                  <span className="text-sm text-muted-foreground">{t('ticketLogoPreviewPending')}</span>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t flex items-center justify-between sticky bottom-0 bg-card">
            <button
              type="button"
              onClick={() => setPaddingPercent(ZERO_PADDING)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <RotateCcw size={14} />
              {t('ticketLogoPaddingReset')}
            </button>
            <button type="button"
              onClick={handleApply}
              className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors"
            >
              <Check size={16} />
              {tProducts('imageCropApply')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasCustomLogo = value !== null;
  const currentPreview = value === 'EXISTING' ? `${previewUrl}?t=${cacheBust}` : (typeof value === 'string' ? value : null);

  return (
    <div className="space-y-2">
      {hasCustomLogo && currentPreview ? (
        <div className="flex items-center gap-4">
          <div className="relative rounded-lg overflow-hidden border border-border bg-white px-2 py-1" style={{ maxWidth: 220 }}>
            <img src={currentPreview} alt="" className="block max-h-20 w-auto mx-auto" />
            <button type="button"
              onClick={handleRemove}
              className="absolute top-1 end-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
            >
              <X size={12} />
            </button>
          </div>
          <div {...getRootProps()} className="cursor-pointer text-sm text-brand hover:underline">
            <input {...getInputProps()} />
            {t('ticketLogoReplace')}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {hasFallbackLogo && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <img src={fallbackPreviewUrl} alt="" className="w-12 h-12 rounded-lg border border-border object-cover bg-white" />
              <span>{t('ticketLogoFallbackHint')}</span>
            </div>
          )}
          <div
            {...getRootProps()}
            className={`w-full flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
              isDragActive ? 'border-brand bg-brand/5 text-brand' : 'border-gray-300 dark:border-border text-muted-foreground hover:border-brand hover:bg-muted'
            }`}
          >
            <input {...getInputProps()} />
            <Upload size={24} className="mb-2 text-gray-400" />
            <p className="text-sm font-medium text-center">
              {isDragActive ? tProducts('imageDropActive') : tProducts('imageDropIdle')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-center">
            <button type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-foreground hover:bg-muted hover:border-gray-400 dark:border-border dark:hover:border-border transition-colors"
            >
              <Camera size={16} />
              {tProducts('imageCamera')}
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onCameraChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

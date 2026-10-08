'use client';

import { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Cropper, { type Area } from 'react-easy-crop';
import { Camera, Upload, X, Check } from 'lucide-react';
import { compressCroppedImage, MAX_RAW_FILE_SIZE } from '@/lib/image-utils';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';

interface LogoUploaderProps {
  /** Current Base64 data URI, 'EXISTING' (stored, unchanged), or null (no logo). */
  value: string | null;
  /** Called when the logo changes (Base64 data URI) or is cleared (null). */
  onChange: (value: string | null) => void;
  /** URL that serves the currently-stored logo (shown when value === 'EXISTING'). */
  previewUrl: string;
}

type Mode = 'idle' | 'cropping';

/** Business logo upload, sharing the crop/compress pipeline with the product ImageUploader. */
export default function LogoUploader({ value, onChange, previewUrl }: LogoUploaderProps) {
  // Reuses the `products` namespace's generic image-upload strings rather than
  // duplicating the same copy across ~30 locale files under a new key.
  const t = useTranslations('products');
  const [mode, setMode] = useState<Mode>('idle');
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cropAreaRef = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });
  const [cacheBust] = useState(() => Date.now());

  const processFile = useCallback(async (file: File) => {
    if (file.size > MAX_RAW_FILE_SIZE) {
      toast.error(t('imageTooLarge', { size: MAX_RAW_FILE_SIZE / 1024 / 1024 }));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('imageSelectFile'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
      setMode('cropping');
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.onerror = () => {
      toast.error(t('imageReadFailed'));
    };
    reader.readAsDataURL(file);
  }, [t]);

  const handleCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    cropAreaRef.current = {
      x: croppedAreaPixels.x,
      y: croppedAreaPixels.y,
      width: croppedAreaPixels.width,
      height: croppedAreaPixels.height,
    };
  }, []);

  const handleCropSave = useCallback(async () => {
    if (!cropSrc) return;

    try {
      const img = new Image();
      img.src = cropSrc;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image for cropping'));
      });

      const width = cropAreaRef.current.width || img.width;
      const height = cropAreaRef.current.height || img.height;
      const x = cropAreaRef.current.x || 0;
      const y = cropAreaRef.current.y || 0;

      const dataUri = compressCroppedImage(img, { x, y, width, height });
      if (!dataUri) {
        toast.error(t('imageCompressFailed'));
        return;
      }

      onChange(dataUri);
      setMode('idle');
      setCropSrc(null);
      toast.success(t('imageReady'));
    } catch {
      toast.error(t('imageCropFailed'));
      setMode('idle');
      setCropSrc(null);
    }
  }, [cropSrc, onChange, t]);

  const handleRemove = useCallback(() => {
    onChange(null);
    setMode('idle');
    setCropSrc(null);
  }, [onChange]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      processFile(acceptedFiles[0]);
    }
  }, [processFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
    noClick: false,
    noKeyboard: false,
  });

  if (mode === 'cropping' && cropSrc) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl max-w-lg w-full overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold text-foreground">{t('cropImage')}</h3>
            <button type="button" onClick={() => { setMode('idle'); setCropSrc(null); }} className="text-gray-400 hover:text-muted-foreground">
              <X size={20} />
            </button>
          </div>
          <div className="relative w-full aspect-square bg-muted">
            <Cropper
              image={cropSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          </div>
          <div className="px-4 py-3 border-t flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
            />
            <button type="button"
              onClick={handleCropSave}
              className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors"
            >
              <Check size={16} />
              {t('imageCropApply')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentPreview = value === 'EXISTING' ? `${previewUrl}?t=${cacheBust}` : value;

  return (
    <div className="space-y-2">
      {currentPreview && (
        <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-border">
          <img src={currentPreview} alt="" className="w-full h-full object-cover" />
          <button type="button"
            onClick={handleRemove}
            className="absolute top-1 end-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div
          {...getRootProps()}
          className={`w-full flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            isDragActive ? 'border-brand bg-brand/5 text-brand' : 'border-gray-300 dark:border-border text-muted-foreground hover:border-brand hover:bg-muted'
          }`}
        >
          <input {...getInputProps()} />
          <Upload size={24} className="mb-2 text-gray-400" />
          <p className="text-sm font-medium text-center">
            {isDragActive ? t('imageDropActive') : t('imageDropIdle')}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          <button type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-foreground hover:bg-muted hover:border-gray-400 dark:border-border dark:hover:border-border transition-colors"
          >
            <Camera size={16} />
            {t('imageCamera')}
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center mt-4">
        {t('imageMaxSize', { size: MAX_RAW_FILE_SIZE / 1024 / 1024 })}
      </p>
    </div>
  );
}

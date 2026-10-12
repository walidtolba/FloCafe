import { useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { MAX_RAW_FILE_SIZE } from '@/lib/image-utils';

interface UseImageFileToDataUriOptions {
  /** Called with the raw file's data URL once read, ready to crop. */
  onLoaded: (dataUri: string) => void;
  /** `useTranslations('products')`'s return value — reuses its existing
   * `imageTooLarge`/`imageSelectFile`/`imageReadFailed` copy. */
  t: (key: string, values?: Record<string, unknown>) => string;
}

/**
 * Shared drag-drop / file-picker / camera-capture intake pipeline: validates
 * the file, reads it to a data URL, and hands it to `onLoaded`. Used by both
 * the square business-logo uploader and the free-crop ticket-logo editor —
 * they diverge entirely on what happens to the file after this point.
 */
export function useImageFileToDataUri({ onLoaded, t }: UseImageFileToDataUriOptions) {
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (file.size > MAX_RAW_FILE_SIZE) {
      toast.error(t('imageTooLarge', { size: MAX_RAW_FILE_SIZE / 1024 / 1024 }));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('imageSelectFile'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => onLoaded(reader.result as string);
    reader.onerror = () => toast.error(t('imageReadFailed'));
    reader.readAsDataURL(file);
  }, [onLoaded, t]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) processFile(acceptedFiles[0]);
  }, [processFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
    noClick: false,
    noKeyboard: false,
  });

  const onCameraChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }, [processFile]);

  return { processFile, getRootProps, getInputProps, isDragActive, cameraInputRef, onCameraChange };
}

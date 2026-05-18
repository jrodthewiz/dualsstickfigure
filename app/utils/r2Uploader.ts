/**
 * R2 Uploader Utility
 * Helper functions for uploading files to Cloudflare R2 bucket
 */

export interface UploadResult {
  success: boolean;
  url?: string;
  key?: string;
  size?: number;
  error?: string;
}

export interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  url?: string;
}

/**
 * Upload a single file to R2
 */
export async function uploadFile(
  file: File,
  path: string = 'animations'
): Promise<UploadResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);
    formData.append('action', 'upload');

    const response = await fetch('/api/r2-upload', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: result.error || 'Upload failed',
      };
    }

    return {
      success: true,
      url: result.url,
      key: result.key,
      size: result.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    };
  }
}

/**
 * Upload multiple files with progress tracking
 */
export async function uploadMultipleFiles(
  files: File[],
  path: string = 'animations',
  onProgress?: (progress: UploadProgress[]) => void
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  const progressStates: UploadProgress[] = files.map(file => ({
    fileName: file.name,
    progress: 0,
    status: 'pending',
  }));

  // Notify initial state
  if (onProgress) {
    onProgress([...progressStates]);
  }

  // Upload files sequentially to avoid overwhelming the server
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Update status to uploading
    progressStates[i].status = 'uploading';
    progressStates[i].progress = 0;
    if (onProgress) {
      onProgress([...progressStates]);
    }

    // Perform upload
    const result = await uploadFile(file, path);
    results.push(result);

    // Update progress based on result
    if (result.success) {
      progressStates[i].status = 'success';
      progressStates[i].progress = 100;
      progressStates[i].url = result.url;
    } else {
      progressStates[i].status = 'error';
      progressStates[i].error = result.error;
    }

    if (onProgress) {
      onProgress([...progressStates]);
    }
  }

  return results;
}

/**
 * Get all files from a directory in the bucket
 */
export async function listFiles(prefix: string = ''): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      prefix,
      maxKeys: '10000',
    });

    const response = await fetch(`/api/r2-upload?${params}`);
    const result = await response.json();

    if (!response.ok) {
      console.error('Failed to list files:', result.error);
      return [];
    }

    return result.files || [];
  } catch (error) {
    console.error('Failed to list files:', error);
    return [];
  }
}

/**
 * Scan a directory for image files (PNG, JPG, etc.)
 * Returns the files and the root folder name
 */
export async function scanDirectoryForImages(
  directoryHandle: FileSystemDirectoryHandle
): Promise<{ files: File[]; rootFolderName: string }> {
  const imageFiles: File[] = [];
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const rootFolderName = directoryHandle.name;

  async function scanRecursive(dirHandle: FileSystemDirectoryHandle, basePath: string = '') {
    // @ts-ignore - File System Access API
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        
        if (allowedExtensions.includes(extension)) {
          // Preserve directory structure in file name, including root folder
          const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
          // Create a new File object with the full path as the name
          const renamedFile = new File([file], fullPath, { type: file.type });
          imageFiles.push(renamedFile);
        }
      } else if (entry.kind === 'directory') {
        const newPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        await scanRecursive(entry, newPath);
      }
    }
  }

  await scanRecursive(directoryHandle);
  return { files: imageFiles, rootFolderName };
}


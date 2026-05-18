"use client";

import React, { useState, useRef } from 'react';
import { scanDirectoryForImages, uploadMultipleFiles, type UploadProgress } from '../utils/r2Uploader';

interface AnimationUploadButtonProps {
  onUploadComplete?: () => void;
}

export default function AnimationUploadButton({ onUploadComplete }: AnimationUploadButtonProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [basePath, setBasePath] = useState('game-assets');
  const [fullUploadPath, setFullUploadPath] = useState('');

  const handleSelectDirectory = async () => {
    try {
      // @ts-ignore - File System Access API
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'read',
      });

      setShowModal(true);
      setIsUploading(true);

      // Scan directory for images
      const { files, rootFolderName } = await scanDirectoryForImages(directoryHandle);
      
      if (files.length === 0) {
        alert('No image files found in the selected directory.');
        setIsUploading(false);
        setShowModal(false);
        return;
      }

      // Construct full path: game-assets/FolderName
      const uploadPath = `${basePath}/${rootFolderName}`;
      setFullUploadPath(uploadPath);

      // Upload all files
      await uploadMultipleFiles(files, uploadPath, (progress) => {
        setUploadProgress(progress);
      });

      setIsUploading(false);
      
      // Call completion callback
      if (onUploadComplete) {
        onUploadComplete();
      }

      // Auto-close after 2 seconds if successful
      setTimeout(() => {
        const allSuccess = uploadProgress.every(p => p.status === 'success');
        if (allSuccess) {
          setShowModal(false);
          setUploadProgress([]);
        }
      }, 2000);
    } catch (error) {
      console.error('Failed to upload animations:', error);
      setIsUploading(false);
      if (error instanceof Error && error.message.includes('user aborted')) {
        setShowModal(false);
      } else {
        alert('Failed to upload animations. Check console for details.');
      }
    }
  };

  const successCount = uploadProgress.filter(p => p.status === 'success').length;
  const errorCount = uploadProgress.filter(p => p.status === 'error').length;
  const totalCount = uploadProgress.length;
  const progressPercent = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

  return (
    <>
      {/* Small Upload Button */}
      <button
        onClick={handleSelectDirectory}
        disabled={isUploading}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          width: '50px',
          height: '50px',
          borderRadius: '50%',
          backgroundColor: isUploading ? '#666' : '#4CAF50',
          color: 'white',
          border: 'none',
          cursor: isUploading ? 'not-allowed' : 'pointer',
          fontSize: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          transition: 'all 0.3s ease',
          zIndex: 9999,
        }}
        onMouseEnter={(e) => {
          if (!isUploading) {
            e.currentTarget.style.backgroundColor = '#45a049';
            e.currentTarget.style.transform = 'scale(1.1)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isUploading) {
            e.currentTarget.style.backgroundColor = '#4CAF50';
            e.currentTarget.style.transform = 'scale(1)';
          }
        }}
        title="Upload Animations to R2 CDN"
      >
        {isUploading ? '⏳' : '☁️'}
      </button>

      {/* Upload Progress Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isUploading) {
              setShowModal(false);
              setUploadProgress([]);
            }
          }}
        >
          <div
            style={{
              backgroundColor: '#1a1a1a',
              padding: '30px',
              borderRadius: '10px',
              maxWidth: '600px',
              maxHeight: '80vh',
              overflow: 'auto',
              color: 'white',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '24px' }}>
              Uploading to R2
            </h2>

            {/* Path Display */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#aaa' }}>
                Base Path (R2 bucket root):
              </label>
              <input
                type="text"
                value={basePath}
                onChange={(e) => setBasePath(e.target.value)}
                disabled={isUploading}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#2a2a2a',
                  border: '1px solid #444',
                  borderRadius: '5px',
                  color: 'white',
                  fontSize: '14px',
                  marginBottom: '12px',
                }}
                placeholder="game-assets"
              />
              
              {fullUploadPath && (
                <div style={{
                  padding: '10px 12px',
                  backgroundColor: '#1a3a1a',
                  border: '1px solid #2a5a2a',
                  borderRadius: '5px',
                  fontSize: '13px',
                  color: '#8fdf8f',
                }}>
                  <strong>Full Upload Path:</strong> {fullUploadPath}/
                </div>
              )}
            </div>

            {/* Overall Progress */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                marginBottom: '8px',
                fontSize: '14px'
              }}>
                <span>Progress: {successCount} / {totalCount}</span>
                <span>{progressPercent}%</span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: '#333',
                borderRadius: '4px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  backgroundColor: '#4CAF50',
                  transition: 'width 0.3s ease',
                }}></div>
              </div>
              {errorCount > 0 && (
                <div style={{ color: '#ff4444', marginTop: '8px', fontSize: '14px' }}>
                  ⚠️ {errorCount} failed
                </div>
              )}
            </div>

            {/* Individual File Progress */}
            <div style={{
              maxHeight: '400px',
              overflow: 'auto',
              border: '1px solid #333',
              borderRadius: '5px',
              padding: '10px',
            }}>
              {uploadProgress.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                  Scanning directory...
                </div>
              ) : (
                uploadProgress.map((progress, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '8px',
                      marginBottom: '8px',
                      backgroundColor: '#2a2a2a',
                      borderRadius: '5px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {progress.fileName}
                    </div>
                    <div style={{ marginLeft: '10px', minWidth: '60px', textAlign: 'right' }}>
                      {progress.status === 'success' && <span style={{ color: '#4CAF50' }}>✓</span>}
                      {progress.status === 'error' && <span style={{ color: '#ff4444' }}>✗</span>}
                      {progress.status === 'uploading' && <span>⏳</span>}
                      {progress.status === 'pending' && <span style={{ color: '#999' }}>⋯</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Close Button */}
            {!isUploading && (
              <button
                onClick={() => {
                  setShowModal(false);
                  setUploadProgress([]);
                }}
                style={{
                  marginTop: '20px',
                  padding: '10px 20px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  width: '100%',
                }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}


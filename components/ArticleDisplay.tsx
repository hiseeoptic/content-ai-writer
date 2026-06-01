
import React, { useState, useMemo } from 'react';
import { BulkArticle } from '../types';
// @ts-ignore
import JSZip from 'jszip';
import { utils, write } from 'xlsx';

interface ArticleDisplayProps {
  article: string;
  bulkArticles: BulkArticle[];
  isLoading: boolean;
  loadingMessage: string;
  error: string | null;
  characterCount: number;
  mode: 'single' | 'bulk';
  bulkProgress: { current: number; total: number } | null;
  onRegenerateImage?: (id: number) => Promise<void>;
}

// Utility to create safe filenames from titles
const sanitizeFilename = (title: string): string => {
    if (!title) return 'untitled';
    return title
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .replace(/[^a-zA-Z0-9\s-_]/g, '') // Remove special chars
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .substring(0, 60); // Limit length
};

// Utility to trigger download blob
const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// Helper function to handle mobile sharing (The only way to get to Photo Library on iOS)
const shareContentMobile = async (title: string, content: string, imageUrl: string | null | undefined) => {
    try {
        const shareData: any = {
            title: title,
            text: content,
        };

        if (imageUrl) {
            // Fetch the image and convert to File object
            try {
                const response = await fetch(imageUrl);
                const blob = await response.blob();
                // Important: iOS needs a specific file type
                const file = new File([blob], `${sanitizeFilename(title)}.png`, { type: 'image/png' });
                
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    shareData.files = [file];
                }
            } catch (e) {
                console.warn("Could not fetch image for sharing", e);
            }
        }

        if (navigator.share) {
            await navigator.share(shareData);
            return true;
        }
        return false;
    } catch (error) {
        console.warn("Sharing failed or cancelled:", error);
        return false;
    }
};

// Helper to aggressively open Native App
const openFacebookNative = () => {
    const userAgent = navigator.userAgent || navigator.vendor;
    const isAndroid = /android/i.test(userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(userAgent);

    // 1. Android Strategy: Use Intent Scheme (Most reliable for forcing app)
    if (isAndroid) {
        // This tells Android: "Open the app with package com.facebook.katana". 
        // Using scheme=fb:// root ensures it just opens the app without failing on deep links
        const intentUrl = 'intent://#Intent;package=com.facebook.katana;scheme=fb://;end';
        window.location.href = intentUrl;
        return;
    }

    // 2. iOS Strategy: Use Root Custom Scheme
    if (isIOS) {
        // Try opening App with root scheme (just open app)
        window.location.href = 'fb://';

        // Check if we are still here after a short delay
        setTimeout(() => {
             // Fallback to web if app not installed or fails
             window.open('https://www.facebook.com', '_blank');
        }, 1500);
        return;
    }

    // 3. Desktop Strategy
    window.open('https://www.facebook.com', '_blank');
};

const AccordionItem: React.FC<{ article: BulkArticle, onRegenerateImage?: (id: number) => Promise<void> }> = React.memo(({ article, onRegenerateImage }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [copySuccess, setCopySuccess] = useState('');
    const [isRegenerating, setIsRegenerating] = useState(false);

    // Defensive check: If article is undefined, don't render
    if (!article) return null;

    // Ensure properties exist
    const content = article.content || "";
    const title = article.title || "Bài viết chưa có tiêu đề";

    const copyToClipboard = async () => {
        const textToCopy = `${title}\n\n${content}`;
        try {
            await navigator.clipboard.writeText(textToCopy);
            return true;
        } catch (err) {
            return false;
        }
    };

    const handleCopy = async () => {
        const success = await copyToClipboard();
        setCopySuccess(success ? 'Đã sao chép!' : 'Lỗi!');
        setTimeout(() => setCopySuccess(''), 2000);
    };

    const handlePostToFacebook = async (e: React.MouseEvent) => {
        e.stopPropagation(); 
        await copyToClipboard();

        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // MOBILE STRATEGY 1: Use Web Share API (Primary)
        // This opens the Native Share Sheet. Choosing Facebook here GUARANTEES opening the App with content.
        if (isMobile && navigator.share) {
            try {
                const shared = await shareContentMobile(title, content, article.imageUrl);
                if (shared) {
                    setCopySuccess('Đã mở Chia sẻ!');
                    setTimeout(() => setCopySuccess(''), 3000);
                    return;
                }
            } catch (err) {
                // If share fails/cancelled, continue to fallback
            }
        }
        
        // DESKTOP STRATEGY: Download Image
        if (!isMobile && article.imageUrl) {
            const link = document.createElement('a');
            link.href = article.imageUrl;
            link.download = `${sanitizeFilename(title)}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // FALLBACK: Aggressively try to open the App
        openFacebookNative();

        setCopySuccess('Đã Copy -> FB!');
        setTimeout(() => setCopySuccess(''), 3000);
    };

    const handleOpenMetaBusiness = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await copyToClipboard();

        // 1. Always try to download/save the image first so user has it for upload
        if (article.imageUrl) {
            const link = document.createElement('a');
            link.href = article.imageUrl;
            link.download = `${sanitizeFilename(title)}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // 2. Simply open the Web URL. 
        // DO NOT use navigator.share or intents here, as Meta Business Suite app often rejects 
        // shared content with "Format not supported" errors.
        // Opening the URL is the safest way.
        window.open('https://business.facebook.com/latest/composer', '_blank');
        
        setCopySuccess('Đã Copy -> Meta!');
        setTimeout(() => setCopySuccess(''), 3000);
    };

    const handleRegenerate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onRegenerateImage && !isRegenerating) {
            setIsRegenerating(true);
            try {
                await onRegenerateImage(article.id);
            } finally {
                setIsRegenerating(false);
            }
        }
    };

    const handleDownloadItem = async () => {
        const safeTitle = sanitizeFilename(title);
        
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // On Mobile, use Share Sheet for the image to ensure it goes to Photo Library
        if (isMobile && navigator.share && article.imageUrl) {
             await shareContentMobile(title, content, article.imageUrl);
             return;
        }

        // 1. Download Text (Desktop)
        const textBlob = new Blob([`${title}\n\n${content}`], { type: 'text/plain;charset=utf-8' });
        downloadBlob(textBlob, `${safeTitle}.txt`);

        // 2. Download Image (Desktop)
        if (article.imageUrl) {
            const link = document.createElement('a');
            link.href = article.imageUrl;
            link.download = `${safeTitle}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
    
    return (
        <div className="bg-gray-700/50 rounded-lg border border-gray-600">
            <h2>
                <button
                    type="button"
                    className="flex items-center justify-between w-full p-3 text-left font-medium text-gray-300 hover:bg-gray-700"
                    onClick={() => setIsExpanded(!isExpanded)}
                    aria-expanded={isExpanded}
                >
                    <span className="flex-1 pr-4 text-sm sm:text-base">{title}</span>
                    {article.error ? (
                         <span title={article.error} className="text-red-400">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.21 3.03-1.742 3.03H4.42c-1.532 0-2.492-1.696-1.742-3.03l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                         </span>
                    ) : (
                         <div className="flex items-center space-x-2 shrink-0">
                             {article.imageUrl && (
                                <span className="flex items-center text-xs text-sky-400" title="Có ảnh minh họa">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                                    </svg>
                                </span>
                             )}
                             <span className="text-xs text-gray-400 hidden sm:inline">{content.length.toLocaleString('vi-VN')} ký tự</span>
                         </div>
                    )}
                   
                    <svg className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 10 6">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5 5 1 1 5"/>
                    </svg>
                </button>
            </h2>
            {isExpanded && (
                <div className="p-3 border-t border-gray-600">
                    {article.error ? (
                         <p className="text-sm text-red-300">{article.error}</p>
                    ) : (
                        <>
                            {article.imageUrl && (
                                <div className="mb-4">
                                    <div className="relative group">
                                        <img src={article.imageUrl} alt={title} className="w-full h-auto rounded-md shadow-sm border border-gray-700" />
                                    </div>
                                    <div className="mt-2 flex justify-end gap-2">
                                         {onRegenerateImage && (
                                            <button 
                                                onClick={handleRegenerate}
                                                disabled={isRegenerating}
                                                className="flex items-center text-xs text-gray-400 hover:text-white transition-colors bg-gray-800/80 px-2 py-1 rounded border border-gray-600 hover:border-gray-500 disabled:opacity-50"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 mr-1 ${isRegenerating ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                                {isRegenerating ? 'Đang tạo...' : 'Tạo lại ảnh'}
                                            </button>
                                         )}
                                         <button 
                                            onClick={handleDownloadItem}
                                            className="flex items-center text-xs text-sky-400 hover:text-sky-300 underline"
                                         >
                                             <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                             </svg>
                                             Lưu ảnh
                                         </button>
                                    </div>
                                </div>
                            )}
                            <div className="whitespace-pre-wrap text-sm text-gray-300 leading-relaxed mb-4">
                                {content}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={handleCopy}
                                    className="flex-1 sm:flex-none inline-flex justify-center items-center px-3 py-2 text-xs font-semibold text-sky-300 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                    Sao chép
                                </button>
                                <button
                                    onClick={handleDownloadItem}
                                    className="flex-1 sm:flex-none inline-flex justify-center items-center px-3 py-2 text-xs font-semibold text-emerald-300 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Tải về / Lưu
                                </button>
                                <button
                                    onClick={handlePostToFacebook}
                                    className="flex-1 sm:flex-none inline-flex justify-center items-center px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                                    </svg>
                                    Đăng FB
                                </button>
                                <button
                                    onClick={handleOpenMetaBusiness}
                                    className="flex-1 sm:flex-none inline-flex justify-center items-center px-3 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                                    </svg>
                                    Meta Suite
                                </button>
                                {copySuccess && <span className="text-xs text-gray-500 italic ml-1 w-full sm:w-auto text-center sm:text-left">{copySuccess}</span>}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
});

const ArticleDisplay: React.FC<ArticleDisplayProps> = ({ article, bulkArticles, isLoading, loadingMessage, error, characterCount, mode, bulkProgress, onRegenerateImage }) => {
  const [copySuccess, setCopySuccess] = useState('');
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [isDownloadingImages, setIsDownloadingImages] = useState(false);

  const successfulBulkArticlesCount = useMemo(() => {
    return bulkArticles.filter(a => !a.error).length;
  }, [bulkArticles]);
  
  const hasImages = useMemo(() => {
    return bulkArticles.some(a => a.imageUrl);
  }, [bulkArticles]);

  const handleCopySingle = async () => {
    try {
      await navigator.clipboard.writeText(article || "");
      setCopySuccess('Đã sao chép!');
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      setCopySuccess('Lỗi!');
      setTimeout(() => setCopySuccess(''), 2000);
    }
  };

  const handleDownloadSingle = () => {
      if (!article) return;
      
      const firstLine = article.split('\n')[0].replace(/[#*]/g, '').trim();
      const safeTitle = sanitizeFilename(firstLine || 'Bai_viet');

      // 1. Text Download
      const textBlob = new Blob([article], { type: 'text/plain;charset=utf-8' });
      downloadBlob(textBlob, `${safeTitle}.txt`);
  };

  const handleDownloadExcel = async () => {
      if (bulkArticles.length === 0 || isDownloadingExcel) return;

      setIsDownloadingExcel(true);
      try {
          const excelRows: any[] = [];
          
          bulkArticles.forEach(item => {
              if (item.error) return;

              const safeTitle = sanitizeFilename(item.title) || `Bai_viet_${item.id}`;
              const imgFilename = item.imageUrl ? `${safeTitle}.png` : '';
              
              // Prepare Excel Data Row
              excelRows.push({
                  "STT": item.id,
                  "Tiêu đề": item.title || "Không tiêu đề",
                  "Nội dung bài viết": item.content || "",
                  "Tên file ảnh": imgFilename
              });
          });

          // Create Excel Worksheet
          const ws = utils.json_to_sheet(excelRows);
          
          // Set column widths for better readability
          ws['!cols'] = [
            { wch: 5 },  // STT
            { wch: 50 }, // Tiêu đề
            { wch: 100 }, // Nội dung
            { wch: 40 }  // Tên file ảnh
          ];

          const wb = utils.book_new();
          utils.book_append_sheet(wb, ws, "Danh sách bài viết");

          // Generate Excel binary
          const excelBuffer = write(wb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          
          const fileName = `Vinalink_AI_Content_${new Date().toISOString().slice(0,10)}.xlsx`;
          downloadBlob(blob, fileName);

      } catch (e) {
          console.error("Excel Error", e);
          alert("Lỗi khi tạo file Excel.");
      } finally {
          setIsDownloadingExcel(false);
      }
  };

  const handleDownloadImages = async () => {
      if (bulkArticles.length === 0 || isDownloadingImages || !hasImages) return;

      setIsDownloadingImages(true);
      try {
          const zip = new JSZip();
          const folderName = `Vinalink_AI_Images_${new Date().toISOString().slice(0,10)}`;
          let count = 0;

          bulkArticles.forEach(item => {
              if (item.error || !item.imageUrl) return;

              const safeTitle = sanitizeFilename(item.title) || `Bai_viet_${item.id}`;
              const imgFilename = `${safeTitle}.png`;
              
              // Remove header "data:image/png;base64,"
              const imgData = item.imageUrl.split(',')[1];
              if (imgData) {
                  zip.file(imgFilename, imgData, {base64: true});
                  count++;
              }
          });

          if (count === 0) {
              alert("Không có ảnh để tải xuống.");
              return;
          }

          // Generate Zip
          const content = await zip.generateAsync({type:"blob"});
          downloadBlob(content, `${folderName}.zip`);

      } catch (e) {
          console.error("Zip Error", e);
          alert("Lỗi khi tạo file ZIP ảnh.");
      } finally {
          setIsDownloadingImages(false);
      }
  };

  const handlePostToFacebookSingle = async () => {
      try {
          await navigator.clipboard.writeText(article || "");
          // Aggressively open Native App
          openFacebookNative();

          setCopySuccess('Đã Copy & Mở FB!');
          setTimeout(() => setCopySuccess(''), 3000);
      } catch (err) {
          setCopySuccess('Lỗi Copy!');
      }
  };

  const handleOpenMetaBusinessSingle = async () => {
      try {
          await navigator.clipboard.writeText(article || "");
          window.open('https://business.facebook.com/latest/composer', '_blank');
          setCopySuccess('Đã Copy & Mở Meta!');
          setTimeout(() => setCopySuccess(''), 3000);
      } catch (err) {
          setCopySuccess('Lỗi Copy!');
      }
  };

  const renderMainContent = () => {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-red-400 bg-red-900/20 p-4 rounded-md">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.21 3.03-1.742 3.03H4.42c-1.532 0-2.492-1.696-1.742-3.03l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          <p><strong>Lỗi:</strong> {error}</p>
        </div>
      );
    }
    
    if (mode === 'single') {
        if (isLoading) {
            return (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <svg className="animate-spin h-10 w-10 text-sky-400 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-lg font-medium text-gray-300">{loadingMessage}</p>
                <p className="text-sm text-gray-500 mt-2 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Quá trình này có thể mất vài phút. Vui lòng không đóng tab.
                </p>
              </div>
            );
        }

        if (!article) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <p>Bài viết của bạn sẽ xuất hiện ở đây...</p>
                </div>
            );
        }

        const paragraphs = article.split('\n').filter(p => p.trim() !== '');
        const title = paragraphs.length > 0 ? paragraphs[0] : '';
        const content = paragraphs.slice(1);
        
        // Calculate words for the statistic footer
        const wordCount = article ? article.trim().split(/\s+/).length : 0;

        return (
             <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold uppercase text-gray-50 mb-6">{title}</h1>
                <div className="prose prose-invert prose-lg max-w-none prose-p:text-gray-300 prose-strong:text-gray-100 whitespace-pre-wrap leading-relaxed">
                    {content.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                </div>

                {/* Character/Word Count Footer */}
                <div className="mt-8 pt-4 border-t border-gray-700/50 flex flex-wrap items-center justify-end gap-4 sm:gap-6 text-sm">
                    <div className="flex items-center text-gray-400 bg-gray-900/40 px-3 py-1.5 rounded-full border border-gray-700/50" title="Số lượng từ ước tính">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                           <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span className="font-semibold text-gray-200 mr-1">{wordCount.toLocaleString('vi-VN')}</span> từ
                    </div>
                    <div className="flex items-center text-sky-400 bg-sky-900/20 px-3 py-1.5 rounded-full border border-sky-800/50" title="Tổng số ký tự">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                           <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="font-bold mr-1">{characterCount.toLocaleString('vi-VN')}</span> ký tự
                    </div>
                </div>
            </div>
        )
    }

    if (mode === 'bulk') {
        const hasResults = bulkArticles.length > 0;
        if (isLoading && !hasResults) {
             return (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <svg className="animate-spin h-10 w-10 text-sky-400 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-lg font-medium text-gray-300">{loadingMessage}</p>
                 <p className="text-sm text-gray-500 mt-2 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Vui lòng không đóng tab trong khi tạo hàng loạt.
                </p>
              </div>
            );
        }

        if (!hasResults) {
             return (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <p>Các bài viết đã tạo sẽ xuất hiện ở đây...</p>
                </div>
            );
        }
        
        return (
            <div className="space-y-2 pb-4">
                {bulkArticles.map(art => <AccordionItem key={art.id} article={art} onRegenerateImage={onRegenerateImage} />)}
            </div>
        );
    }

    return null;
  };

  return (
    <div className="bg-gray-800/50 p-6 rounded-xl shadow-lg border border-gray-700 h-full flex flex-col min-h-0">
       <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-700 flex-shrink-0">
        <h2 className="text-xl sm:text-2xl font-bold text-sky-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            {mode === 'single' ? 'Kết quả' : `Kết quả (${successfulBulkArticlesCount})`}
        </h2>
        
        {/* Bulk Action: Download Separate */}
        {mode === 'bulk' && successfulBulkArticlesCount > 0 && !isLoading && (
            <div className="flex space-x-2">
                <button
                    onClick={handleDownloadExcel}
                    disabled={isDownloadingExcel}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-sm font-semibold transition-colors disabled:opacity-50 border border-emerald-600"
                    title="Tải file Excel chứa nội dung"
                >
                    {isDownloadingExcel ? (
                         <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                             <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    )}
                    <span className="hidden sm:inline">Excel</span>
                </button>
                
                {hasImages && (
                     <button
                        onClick={handleDownloadImages}
                        disabled={isDownloadingImages}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded text-sm font-semibold transition-colors disabled:opacity-50 border border-purple-600"
                        title="Tải toàn bộ hình ảnh (ZIP)"
                    >
                        {isDownloadingImages ? (
                             <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        )}
                        <span className="hidden sm:inline">Ảnh (Zip)</span>
                    </button>
                )}
            </div>
        )}

        {mode === 'single' && article && !isLoading && (
            <div className="flex items-center space-x-2 sm:space-x-4">
                 <span className="text-xs sm:text-sm text-gray-400 hidden sm:inline">{characterCount.toLocaleString('vi-VN')} ký tự</span>
                 <button
                    onClick={handleCopySingle}
                    className="relative inline-flex items-center px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold text-sky-400 bg-gray-700 rounded-md hover:bg-gray-600 transition-colors"
                    >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {copySuccess || 'Sao chép'}
                </button>
                 <button
                    onClick={handleDownloadSingle}
                    className="relative inline-flex items-center px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold text-emerald-300 bg-gray-700 rounded-md hover:bg-gray-600 transition-colors"
                    >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Tải về
                </button>
                 <button
                    onClick={handlePostToFacebookSingle}
                    className="inline-flex items-center px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                    Đăng FB
                </button>
                 <button
                    onClick={handleOpenMetaBusinessSingle}
                    className="inline-flex items-center px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                    </svg>
                    Meta Suite
                </button>
            </div>
        )}
       </div>
      <div className="flex-grow overflow-y-auto pr-2 -mr-4 pl-1 min-h-0">
        {renderMainContent()}
      </div>
       {mode === 'bulk' && isLoading && bulkProgress && bulkProgress.total > 0 && (
          <div className="flex-shrink-0 pt-4 mt-4 border-t border-gray-700">
              <p className="text-sm font-medium text-gray-300 mb-2 text-center">{loadingMessage}</p>
              <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div className="bg-sky-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}></div>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">{bulkProgress.current} / {bulkProgress.total} hoàn thành</p>
          </div>
      )}
    </div>
  );
};

export default ArticleDisplay;

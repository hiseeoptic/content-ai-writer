
import React, { useState, useCallback, useEffect } from 'react';
import { TocItem, BulkItem, AspectRatio, CharacterOption, BulkArticle, HistoryRecord, ReferenceImage, CharacterImage, ImageStyle } from './types';
import {
    generateTableOfContents,
    generateIntroduction,
    generateSectionContent,
    generateConclusion,
    generateTitle,
    generateBatchArticles,
    analyzeReferenceImage,
    generateBlogImage,
    remasterArticle,
    generateShortsScript
} from './services/aiService';
import { saveHistory, getHistory, getHistoryById } from './services/historyService';
import ArticleForm from './components/ArticleForm';
import ArticleDisplay from './components/ArticleDisplay';
import HistorySidebar from './components/HistorySidebar';

// Helper delay function for local use in App.tsx
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to chunk array
const chunkArray = <T,>(array: T[], size: number): T[][] => {
    const chunked: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};

// --- TYPES FOR MOBILE NAV ---
type MobileTab = 'single' | 'bulk' | 'result';

function App() {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [mobileTab, setMobileTab] = useState<MobileTab>('single'); // Control what's visible on mobile

  const [generatedArticle, setGeneratedArticle] = useState('');
  const [bulkArticles, setBulkArticles] = useState<BulkArticle[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [characterCount, setCharacterCount] = useState(0);
  const [selectedLength, setSelectedLength] = useState(20000);
  
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // --- IMAGE STATE MANAGEMENT (Arrays) ---
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [characterImages, setCharacterImages] = useState<CharacterImage[]>([]);
  
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [characterOption, setCharacterOption] = useState<CharacterOption>('no-character');
  const [imageStyle, setImageStyle] = useState<ImageStyle>('realistic');

  // --- IMAGE HANDLERS ---
  const handleAddReferenceImage = (base64: string) => {
    setReferenceImages(prev => [...prev, { id: Date.now().toString(), base64, keyword: '' }]);
  };
  const handleRemoveReferenceImage = (id: string) => {
    setReferenceImages(prev => prev.filter(img => img.id !== id));
  };
  const handleUpdateReferenceKeyword = (id: string, keyword: string) => {
    setReferenceImages(prev => prev.map(img => img.id === id ? { ...img, keyword } : img));
  };

  const handleAddCharacterImage = (base64: string) => {
    setCharacterImages(prev => [...prev, { id: Date.now().toString(), base64 }]);
  };
  const handleRemoveCharacterImage = (id: string) => {
    const newImages = characterImages.filter(img => img.id !== id);
    setCharacterImages(newImages);
    if (newImages.length === 0) {
        setCharacterOption('no-character');
    }
  };

  // --- WAKE LOCK IMPLEMENTATION ---
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
        if (isLoading && 'wakeLock' in navigator) {
            try {
                // @ts-ignore
                wakeLock = await navigator.wakeLock.request('screen');
            } catch (err) {}
        }
    };
    const releaseWakeLock = async () => {
        if (wakeLock) {
            try { await wakeLock.release(); wakeLock = null; } catch (err) { }
        }
    };
    if (isLoading) requestWakeLock();
    else releaseWakeLock();

    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && isLoading) requestWakeLock();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
        releaseWakeLock();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLoading]);

  // --- AUTO-RESTORE LOGIC ---
  useEffect(() => {
    const restoreSession = async () => {
        setIsRestoring(true);
        try {
            const activeSessionId = localStorage.getItem('active_session_id');
            const lastMode = localStorage.getItem('active_mode');
            let record: HistoryRecord | undefined;
            if (activeSessionId) {
                record = await getHistoryById(activeSessionId);
            }
            if (record) {
                restoreRecordToState(record);
            } else {
                const history = await getHistory();
                if (history.length > 0) {
                    restoreRecordToState(history[0]);
                } else if (lastMode === 'single' || lastMode === 'bulk') {
                    setMode(lastMode);
                    setMobileTab(lastMode);
                }
            }
        } catch (e) {
            console.error("Error auto-restoring:", e);
        } finally {
            setIsRestoring(false);
        }
    };
    restoreSession();
  }, []);

  const restoreRecordToState = (record: HistoryRecord) => {
      if (record.mode === 'single' && record.singleContent) {
          setMode('single');
          setGeneratedArticle(record.singleContent);
          // Auto switch to result on restore
          setMobileTab('result');
      } else if (record.mode === 'bulk' && record.bulkContent) {
          setMode('bulk');
          const safeBulkContent = record.bulkContent.map(a => ({
              ...a,
              content: a.content || "",
              title: a.title || "Không tiêu đề"
          }));
          setBulkArticles(safeBulkContent);
          // Auto switch to result on restore
          setMobileTab('result');
      }
      
      // Restore Image Configuration
      setReferenceImages(record.referenceImages || []);
      setCharacterImages(record.characterImages || []);
      setAspectRatio(record.aspectRatio || '16:9');
      setCharacterOption(record.characterOption || 'no-character');
      setImageStyle(record.imageStyle || 'realistic');

      localStorage.setItem('active_session_id', record.id);
      localStorage.setItem('active_mode', record.mode);
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isLoading || generatedArticle.length > 0 || bulkArticles.length > 0) {
        e.preventDefault();
        e.returnValue = ''; 
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isLoading, generatedArticle, bulkArticles]);

  useEffect(() => {
    if (mode === 'single') setCharacterCount(generatedArticle.length);
  }, [generatedArticle, mode]);

  const handleModeChange = (newMode: 'single' | 'bulk') => {
      setMode(newMode);
      setMobileTab(newMode); // Sync mobile tab when mode changes
      localStorage.setItem('active_mode', newMode);
      setError(null);
      // setGeneratedArticle(''); // Optional: Clear result when switching? Better keep it.
      // setBulkArticles([]);
  };

  // Explicit Mobile Tab Switch
  const handleMobileTabChange = (tab: MobileTab) => {
      setMobileTab(tab);
      if (tab === 'single') {
          setMode('single');
          localStorage.setItem('active_mode', 'single');
      } else if (tab === 'bulk') {
          setMode('bulk');
          localStorage.setItem('active_mode', 'bulk');
      }
      // If 'result', we don't change mode, just view.
  };

  const handleGenerateArticle = useCallback(async (prompt: string, language: 'vi' | 'en' = 'vi') => {
    const outline = prompt.trim();
    if (!outline) { setError('Vui lòng nhập yêu cầu.'); return; }

    setIsLoading(true);
    setMobileTab('result'); // Auto switch to result view
    setError(null);
    setGeneratedArticle('');
    
    const sessionId = Date.now().toString();
    localStorage.setItem('active_session_id', sessionId);
    localStorage.setItem('active_mode', 'single');

    try {
      let fullArticle = "";
      
      if (selectedLength === 2000 || selectedLength === 3000) {
          setLoadingMessage('Đang viết kịch bản Shorts...');
          const scriptContent = await generateShortsScript(outline, selectedLength, language);
          
          await delay(500);
          setLoadingMessage('Đang tạo tiêu đề...');
          const generatedTitle = await generateTitle(scriptContent, outline, language);
          
          fullArticle = `${generatedTitle}\n\n${scriptContent}`;
      } else {
          setLoadingMessage('Đang phân tích và tạo mục lục...');
          const toc = await generateTableOfContents(outline, outline, selectedLength, language);
          if (toc.length === 0) throw new Error("Không tạo được mục lục.");
          
          await delay(1000);
          setLoadingMessage('Đang viết Mở bài...');
          const introduction = await generateIntroduction(outline, outline, selectedLength, language);
          
          const sectionContents: string[] = [];
          for (let i = 0; i < toc.length; i++) {
              if (i > 0) await delay(1000);
              setLoadingMessage(`Đang viết chương ${i + 1}/${toc.length}: ${toc[i].sectionTitle}...`);
              const content = await generateSectionContent(outline, toc[i], toc.length, selectedLength, language);
              sectionContents.push(content);
          }

          const articleBody = sectionContents.join('\n\n');
          await delay(1000);
          setLoadingMessage('Đang viết Kết bài...');
          const conclusion = await generateConclusion(outline, articleBody, selectedLength, language);
          const articleContentWithoutTitle = `${introduction}\n\n${articleBody}\n\n${conclusion}`;
          
          await delay(500);
          setLoadingMessage('Đang tạo tiêu đề...');
          
          const generatedTitle = await generateTitle(articleContentWithoutTitle, outline, language);
          
          fullArticle = `${generatedTitle}\n\n${articleContentWithoutTitle}`;
      }

      setGeneratedArticle(fullArticle);
      try { 
          // Pass current image settings (if any) to history
          await saveHistory('single', fullArticle, sessionId, {
              referenceImages,
              characterImages,
              aspectRatio,
              characterOption,
              imageStyle
          }); 
      } catch (e) {}

    } catch (err: any) {
      setError(err.message || 'Lỗi không xác định.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, [selectedLength, referenceImages, characterImages, aspectRatio, characterOption, imageStyle]);

  // Handle remastering from an input text (Input mode in Form)
  const handleRemasterFromInput = useCallback(async (content: string, instruction: string, language: 'vi' | 'en') => {
      if (!content.trim()) { setError('Vui lòng nhập nội dung cần viết lại.'); return; }
      if (!instruction.trim()) { setError('Vui lòng nhập yêu cầu văn phong.'); return; }

      setIsLoading(true);
      setMobileTab('result');
      setError(null);
      setGeneratedArticle('');
      setLoadingMessage('Đang viết lại bài theo yêu cầu...');
      
      const sessionId = Date.now().toString();
      localStorage.setItem('active_session_id', sessionId);
      localStorage.setItem('active_mode', 'single');

      try {
          const remasteredContent = await remasterArticle(content, instruction, language);
          setGeneratedArticle(remasteredContent);
          
          try { 
              await saveHistory('single', remasteredContent, sessionId, {
                  referenceImages,
                  characterImages,
                  aspectRatio,
                  characterOption,
                  imageStyle
              }); 
          } catch (e) {}
      } catch (err: any) {
          setError(`Lỗi Remaster: ${err.message}`);
      } finally {
          setIsLoading(false);
          setLoadingMessage('');
      }
  }, [referenceImages, characterImages, aspectRatio, characterOption, imageStyle]);

  const handleGenerateBulkArticles = useCallback(async (
      items: BulkItem[], 
      refImages: ReferenceImage[], 
      ratio: AspectRatio, 
      charOpt: CharacterOption, 
      targetLength: number,
      charImages: CharacterImage[],
      useDescKeywords: boolean,
      style: ImageStyle
    ) => {
    
    // Store in state (though already there, ensure latest update)
    setReferenceImages(refImages);
    setAspectRatio(ratio);
    setCharacterOption(charOpt);
    setCharacterImages(charImages);
    setImageStyle(style);

    const validItems = items.filter(item => item.title.trim() !== '' || item.outline.trim() !== '');
    if (validItems.length === 0) {
      setError('Vui lòng nhập ít nhất một tiêu đề.');
      return;
    }

    setIsLoading(true);
    setMobileTab('result'); // Auto switch to result view
    setError(null);
    setBulkArticles([]);
    setBulkProgress({ current: 0, total: validItems.length });
    
    const sessionId = Date.now().toString();
    localStorage.setItem('active_session_id', sessionId);
    localStorage.setItem('active_mode', 'bulk');
    
    let styleDescription = "Professional, high quality blog illustration.";
    if (refImages.length > 0 && style === 'realistic') {
        setLoadingMessage("Đang phân tích phong cách ảnh...");
        // Use the first image for style analysis to keep it consistent
        styleDescription = await analyzeReferenceImage(refImages[0].base64);
    }

    setLoadingMessage(`Chuẩn bị tạo ${validItems.length} bài viết...`);

    // --- ADAPTIVE BATCH SIZE STRATEGY ---
    let batchSize = 1;
    if (targetLength <= 1000) batchSize = 5; 
    else if (targetLength <= 3000) batchSize = 3; 
    
    const chunks = chunkArray(validItems, batchSize);
    let completedCount = 0;
    const allResults: BulkArticle[] = [];

    // Process chunks
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (i > 0) await delay(100);

        setLoadingMessage(`Đang xử lý nhóm ${i + 1}/${chunks.length} (${chunk.length} bài)...`);
        
        try {
            // 1. Generate Batch Text + Briefs
            const batchResults = await generateBatchArticles(
                chunk,
                targetLength,
                charOpt,
                style // Pass selected style
            );

            // 2. Process Results & Generate Images (Sequentially or Parallel inside chunk)
            for (const result of batchResults) {
                // Find original item to get outline for strict keyword matching
                const originalItem = chunk.find(c => c.id === result.id);
                
                // Construct a search context: Title + Outline + Start of Content
                const generatedSnippet = result.content ? result.content.substring(0, 1000) : "";
                const searchContext = `${originalItem?.title || ""} ${originalItem?.outline || ""} ${generatedSnippet}`;
                
                let generatedImageUrl: string | null = null;

                // Only generate image if text generation was successful
                if (!result.error && result.content) {
                    // PASS THE ARRAYS TO GENERATEBLOGIMAGE
                    generatedImageUrl = await generateBlogImage(
                        result.title,
                        styleDescription,
                        ratio,
                        refImages, // Pass array
                        charOpt,
                        charImages, // Pass array
                        searchContext, // Pass full context for keyword matching
                        result.imageBriefJson,
                        style // Pass selected style
                    );
                }

                allResults.push({
                    id: result.id,
                    title: result.title,
                    content: result.content,
                    imageUrl: generatedImageUrl,
                    outline: chunk.find(c => c.id === result.id)?.outline,
                    error: result.error
                });
                
                completedCount++;
                setBulkProgress({ current: completedCount, total: validItems.length });
                // Incremental UI Update
                setBulkArticles([...allResults]);
                
                // Incremental Save WITH IMAGE CONTEXT
                try { 
                    await saveHistory('bulk', [...allResults], sessionId, {
                        referenceImages: refImages,
                        characterImages: charImages,
                        aspectRatio: ratio,
                        characterOption: charOpt,
                        imageStyle: style
                    }); 
                } catch (e) {}
            }

        } catch (err: any) {
             // Fallback for chunk failure
             chunk.forEach(item => {
                 allResults.push({
                     id: item.id,
                     title: item.title,
                     content: "",
                     error: "Lỗi xử lý hàng loạt: " + err.message,
                     outline: item.outline
                 });
             });
             setBulkArticles([...allResults]);
        }
    }

    setIsLoading(false);
    setLoadingMessage('');
    setBulkProgress(null);
  }, []);

  const handleRegenerateImage = async (articleId: number) => {
    const article = bulkArticles.find(a => a.id === articleId);
    if (!article) return;
    
    let styleDescription = "Professional, high quality blog illustration.";
    if (referenceImages.length > 0 && imageStyle === 'realistic') styleDescription = await analyzeReferenceImage(referenceImages[0].base64);
    
    // For regeneration, we use Title + Outline as context
    const searchContext = `${article.title} ${article.outline || ""}`;

    const newImageUrl = await generateBlogImage(
        article.title,
        styleDescription,
        aspectRatio,
        referenceImages,
        characterOption,
        characterImages,
        searchContext, // Pass context here too
        null, // Regenerate brief logic inside
        imageStyle // Use current style
    );

    if (newImageUrl) {
        const updatedArticles = bulkArticles.map(a => a.id === articleId ? { ...a, imageUrl: newImageUrl } : a);
        setBulkArticles(updatedArticles);
        const activeSessionId = localStorage.getItem('active_session_id');
        if (activeSessionId) {
            try { 
                // Save updated results AND KEEP IMAGE CONTEXT
                await saveHistory('bulk', updatedArticles, activeSessionId, {
                    referenceImages,
                    characterImages,
                    aspectRatio,
                    characterOption,
                    imageStyle
                }); 
            } catch (e) {}
        }
    } else {
        alert("Không thể tạo lại ảnh.");
    }
  };

  const handleRestoreHistory = (item: HistoryRecord) => {
      restoreRecordToState(item);
      setIsHistoryOpen(false);
  };

  if (isRestoring) return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center">
           <div className="text-center">
                <svg className="animate-spin h-10 w-10 text-sky-400 mx-auto mb-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <p className="text-lg font-medium text-gray-300">Khôi phục phiên làm việc...</p>
           </div>
      </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-2 sm:p-4 lg:h-screen lg:overflow-hidden h-auto overflow-y-auto">
      <HistorySidebar isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onRestore={handleRestoreHistory} />
      
      {/* HEADER & MOBILE NAVIGATION */}
      <div className="w-full max-w-full mx-auto flex-shrink-0 mb-4">
        {/* Mobile Tab Bar - Only visible on small screens */}
        <div className="lg:hidden flex justify-between bg-gray-800 p-1 rounded-lg border border-gray-700 mb-2 shadow-md">
            <button 
                onClick={() => handleMobileTabChange('single')}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-md transition-colors ${mobileTab === 'single' ? 'bg-sky-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
                Một Bài
            </button>
            <button 
                onClick={() => handleMobileTabChange('bulk')}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-md transition-colors ${mobileTab === 'bulk' ? 'bg-sky-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
                Hàng Loạt
            </button>
            <button 
                onClick={() => handleMobileTabChange('result')}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-md transition-colors relative ${mobileTab === 'result' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
                Kết Quả
                {/* Badge if results exist */}
                {(generatedArticle || bulkArticles.length > 0) && (
                     <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
                )}
            </button>
            <button 
                onClick={() => setIsHistoryOpen(true)}
                className="ml-1 px-3 py-2 text-gray-400 hover:text-white bg-gray-700/50 rounded-md"
            >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </button>
        </div>
      </div>

      <div className="w-full max-w-full mx-auto flex flex-col flex-grow lg:h-full h-auto">
        <main className="flex-grow flex lg:flex-row gap-4 lg:min-h-0 h-auto">
          
          {/* LEFT SIDE: FORM INPUT */}
          {/* Logic: Hidden on mobile if 'result' tab is active. Visible on Desktop always. */}
          <div className={`w-full lg:w-1/2 flex flex-col lg:h-full h-[85dvh] min-h-0 shrink-0 ${mobileTab === 'result' ? 'hidden lg:flex' : 'flex'}`}>
            
             {/* Desktop Mode Toggle Header - Only visible on LG screens */}
             <div className="hidden lg:flex justify-between items-center mb-4 bg-gray-800/80 p-3 rounded-lg border border-gray-700">
                <div className="bg-gray-700 p-1 rounded-lg inline-flex">
                    <button
                        type="button"
                        onClick={() => handleModeChange('single')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                        mode === 'single'
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'text-gray-400 hover:text-white hover:bg-gray-600'
                        }`}
                    >
                        Một bài
                    </button>
                    <button
                        type="button"
                        onClick={() => handleModeChange('bulk')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                        mode === 'bulk'
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'text-gray-400 hover:text-white hover:bg-gray-600'
                        }`}
                    >
                        Hàng loạt
                    </button>
                </div>
                 <button
                    type="button"
                    onClick={() => setIsHistoryOpen(true)}
                    className="text-gray-400 hover:text-white p-2 hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Lịch sử
                </button>
             </div>

            <ArticleForm 
              mode={mode}
              onModeChange={handleModeChange}
              onGenerate={handleGenerateArticle} 
              onGenerateBulk={handleGenerateBulkArticles}
              onRemasterFromInput={handleRemasterFromInput}
              isLoading={isLoading}
              selectedLength={selectedLength}
              onLengthChange={setSelectedLength}
              onOpenHistory={() => setIsHistoryOpen(true)}
              
              // Pass Image Arrays and Handlers
              referenceImages={referenceImages}
              onAddReferenceImage={handleAddReferenceImage}
              onRemoveReferenceImage={handleRemoveReferenceImage}
              onUpdateReferenceKeyword={handleUpdateReferenceKeyword}

              characterImages={characterImages}
              onAddCharacterImage={handleAddCharacterImage}
              onRemoveCharacterImage={handleRemoveCharacterImage}

              currentAspectRatio={aspectRatio}
              onAspectRatioChange={setAspectRatio}
              currentCharacterOption={characterOption}
              onCharacterOptionChange={setCharacterOption}

              imageStyle={imageStyle}
              onImageStyleChange={setImageStyle}
            />
          </div>

          {/* RIGHT SIDE: RESULTS */}
          {/* Logic: Hidden on mobile if tab is NOT 'result'. Visible on Desktop always. */}
          <div className={`w-full lg:w-1/2 flex flex-col lg:h-full h-[85dvh] min-h-0 shrink-0 ${mobileTab !== 'result' ? 'hidden lg:flex' : 'flex'}`}>
            <ArticleDisplay
              mode={mode}
              article={generatedArticle}
              bulkArticles={bulkArticles}
              isLoading={isLoading}
              loadingMessage={loadingMessage}
              bulkProgress={bulkProgress}
              error={error}
              characterCount={characterCount}
              onRegenerateImage={handleRegenerateImage}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
export default App;


import React, { useState, useEffect, useRef } from 'react';
import { read, utils } from 'xlsx';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import { BulkItem, AspectRatio, CharacterOption, ReferenceImage, CharacterImage, ImageStyle } from '../types';

// Set worker manually for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.7.284/pdf.worker.min.mjs';

interface ArticleFormProps {
  onGenerate: (prompt: string, language: 'vi' | 'en') => void;
  onGenerateBulk: (items: BulkItem[], referenceImages: ReferenceImage[], aspectRatio: AspectRatio, characterOption: CharacterOption, targetLength: number, characterImages: CharacterImage[], useDescriptionKeywords: boolean, imageStyle: ImageStyle) => void;
  onRemasterFromInput: (content: string, instruction: string, language: 'vi' | 'en') => void;
  isLoading: boolean;
  selectedLength: number;
  onLengthChange: (length: number) => void;
  mode: 'single' | 'bulk';
  onModeChange: (mode: 'single' | 'bulk') => void;
  onOpenHistory: () => void;
  
  // Updated props for array-based images
  referenceImages: ReferenceImage[];
  onAddReferenceImage: (base64: string) => void;
  onRemoveReferenceImage: (id: string) => void;
  onUpdateReferenceKeyword: (id: string, keyword: string) => void;

  characterImages: CharacterImage[];
  onAddCharacterImage: (base64: string) => void;
  onRemoveCharacterImage: (id: string) => void;
  
  currentAspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  currentCharacterOption: CharacterOption;
  onCharacterOptionChange: (opt: CharacterOption) => void;

  imageStyle: ImageStyle;
  onImageStyleChange: (style: ImageStyle) => void;
}

const characterOptions = [2000, 3000, 5000, 10000, 20000, 40000, 80000];
const bulkLengthOptions = [100, 300, 500, 1000, 2000, 3000];

const ArticleForm: React.FC<ArticleFormProps> = ({ 
  onGenerate, 
  onGenerateBulk,
  onRemasterFromInput,
  isLoading, 
  selectedLength, 
  onLengthChange,
  mode,
  onModeChange,
  onOpenHistory,
  referenceImages,
  onAddReferenceImage,
  onRemoveReferenceImage,
  onUpdateReferenceKeyword,
  characterImages,
  onAddCharacterImage,
  onRemoveCharacterImage,
  currentAspectRatio,
  onAspectRatioChange,
  currentCharacterOption,
  onCharacterOptionChange,
  imageStyle,
  onImageStyleChange
}) => {
  // --- PERSISTENT DRAFT STATE ---
  const [prompt, setPrompt] = useState(() => {
      return localStorage.getItem('draft_prompt') || '';
  });

  const [bulkItems, setBulkItems] = useState<BulkItem[]>(() => {
    const saved = localStorage.getItem('draft_bulk');
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error("Failed to parse draft bulk items", e);
        }
    }
    return Array.from({ length: 31 }, (_, i) => ({ id: i + 1, title: '', outline: '' }));
  });
  
  // Single Mode Sub-tabs
  const [singleModeType, setSingleModeType] = useState<'write' | 'remaster'>('write');
  const [writeLanguage, setWriteLanguage] = useState<'vi' | 'en'>('vi');
  const [remasterContent, setRemasterContent] = useState('');
  const [remasterStyle, setRemasterStyle] = useState('');
  const [remasterLanguage, setRemasterLanguage] = useState<'vi' | 'en'>('vi');

  // Refs (used to clear inputs after selection)
  const refInputRef = useRef<HTMLInputElement>(null);
  const charInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
      localStorage.setItem('draft_prompt', prompt);
  }, [prompt]);

  useEffect(() => {
      const timeout = setTimeout(() => {
          localStorage.setItem('draft_bulk', JSON.stringify(bulkItems));
      }, 500);
      return () => clearTimeout(timeout);
  }, [bulkItems]);


  const [isParsingSheet, setIsParsingSheet] = useState(false);
  const [bulkLength, setBulkLength] = useState<number>(3000);
  const [showTextImport, setShowTextImport] = useState(false);
  const [textImportContent, setTextImportContent] = useState('');

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const isPromptDirty = prompt.trim().length > 0;
      const isBulkDirty = bulkItems.some(item => item.title.trim() !== '' || item.outline.trim() !== '');
      if ((isPromptDirty || isBulkDirty || isParsingSheet) && !isLoading) {
        e.preventDefault();
        e.returnValue = ''; 
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [prompt, bulkItems, isParsingSheet, isLoading]);

  const handleBulkItemChange = (id: number, field: 'title' | 'outline', value: string) => {
    setBulkItems(prevItems =>
      prevItems.map(item => (item.id === id ? { ...item, [field]: value } : item))
    );
  };
  
  const handleClearBulkItem = (id: number) => {
    setBulkItems(prevItems => {
      const remainingItems = prevItems.filter(item => item.id !== id);
      const targetLength = Math.max(remainingItems.length, 31);
      const reIndexedItems: BulkItem[] = [];
      remainingItems.forEach((item, index) => {
          reIndexedItems.push({ ...item, id: index + 1 });
      });
      while (reIndexedItems.length < targetLength) {
          reIndexedItems.push({ id: reIndexedItems.length + 1, title: '', outline: '' });
      }
      return reIndexedItems;
    });
  };
  
  const handleClearAllBulkItems = () => {
    setBulkItems(() => Array.from({ length: 31 }, (_, i) => ({ id: i + 1, title: '', outline: '' })));
    localStorage.removeItem('draft_bulk');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64String = reader.result as string;
              const base64Data = base64String.split(',')[1];
              onAddReferenceImage(base64Data);
              // Reset input
              if (refInputRef.current) refInputRef.current.value = '';
          };
          reader.readAsDataURL(file);
      }
  };

  const handleCharacterImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64String = reader.result as string;
              const base64Data = base64String.split(',')[1];
              onAddCharacterImage(base64Data);
              onCharacterOptionChange('with-character');
              if (charInputRef.current) charInputRef.current.value = '';
          };
          reader.readAsDataURL(file);
      }
  };

  const parsePdfFile = async (arrayBuffer: ArrayBuffer): Promise<BulkItem[]> => {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      const parsedItems: BulkItem[] = [];

      for (let p = 1; p <= numPages; p++) {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const items = textContent.items;

        if (items.length === 0) continue;
        const rows: { y: number; cols: { x: number; text: string }[] }[] = [];
        const Y_TOLERANCE = 8; 

        items.forEach((item: any) => {
            const y = item.transform[5]; 
            const x = item.transform[4]; 
            const text = item.str.trim();
            if (!text) return;
            let row = rows.find(r => Math.abs(r.y - y) < Y_TOLERANCE);
            if (row) { row.cols.push({ x, text }); } else { rows.push({ y, cols: [{ x, text }] }); }
        });

        rows.sort((a, b) => b.y - a.y);

        rows.forEach(row => {
            row.cols.sort((a, b) => a.x - b.x);
            const colsText = row.cols.map(c => c.text);
            if (colsText.length > 1) {
                const firstCol = colsText[0].toLowerCase();
                if (firstCol.includes('tiêu đề') || firstCol.includes('title') || firstCol === 'stt' || firstCol === 'id') {
                    return; 
                }
            }
            let title = '';
            let outline = '';
            if (colsText.length >= 3) {
                 title = colsText[1];
                 outline = colsText.slice(2).join(' ');
            } else if (colsText.length === 2) {
                 title = colsText[0];
                 outline = colsText[1];
            } else if (colsText.length === 1) { return; }

            if (title || outline) {
                parsedItems.push({
                    id: parsedItems.length + 1,
                    title: title,
                    outline: outline
                });
            }
        });
      }
      return parsedItems;
    } catch (e) {
      console.error("PDF Parse Error:", e);
      throw new Error("Lỗi khi đọc file PDF. Đảm bảo file có dạng bảng.");
    }
  };

  const handleSheetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingSheet(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
        try {
            const arrayBuffer = event.target?.result;
            if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) { throw new Error("Không thể đọc tệp."); }

            let parsedItems: BulkItem[] = [];

            if (file.type === 'application/pdf') {
                parsedItems = await parsePdfFile(arrayBuffer);
            } else {
                const workbook = read(arrayBuffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const data: any[][] = utils.sheet_to_json(worksheet, { header: 1 });

                if (data.length === 0) { throw new Error("File không có dữ liệu."); }

                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    if (!row || row.length === 0) continue;
                    if (i === 0 && row.length >= 2 && typeof row[1] === 'string' && 
                       (row[1].toLowerCase().includes('tiêu đề') || row[1].toLowerCase().includes('title'))) {
                        continue;
                    }
                    const titleRaw = row[1];
                    const outlineRaw = row[2];
                    if (!titleRaw && !outlineRaw) continue;
                    parsedItems.push({
                        id: parsedItems.length + 1,
                        title: titleRaw ? String(titleRaw).trim() : '',
                        outline: outlineRaw ? String(outlineRaw).trim() : ''
                    });
                }
            }
            if (parsedItems.length === 0) { alert("Không tìm thấy dữ liệu hợp lệ trong file."); return; }
            const minRows = 31;
            while (parsedItems.length < minRows) {
                parsedItems.push({ id: parsedItems.length + 1, title: '', outline: '' });
            }
            setBulkItems(parsedItems);
        } catch (error: any) {
            console.error("Error parsing file:", error);
            alert(error.message || "Đã xảy ra lỗi khi đọc file.");
        } finally {
            setIsParsingSheet(false);
            if (e.target) { e.target.value = ''; }
        }
    };

    reader.onerror = () => {
        alert("Không thể đọc tệp.");
        setIsParsingSheet(false);
        if (e.target) { e.target.value = ''; }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleTextImportSubmit = () => {
    if (!textImportContent.trim()) { setShowTextImport(false); return; }
    const lines = textImportContent.split('\n');
    const parsedItems: BulkItem[] = [];
    lines.forEach((line) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        const parts = trimmedLine.split('|').map(p => p.trim());
        let title = '';
        let outline = '';
        if (parts.length >= 3) { title = parts[1]; outline = parts[2]; } 
        else if (parts.length === 2) { title = parts[0]; outline = parts[1]; } 
        else if (parts.length === 1) { title = parts[0]; }
        if (title || outline) { parsedItems.push({ id: parsedItems.length + 1, title: title, outline: outline }); }
    });
    if (parsedItems.length > 0) {
        const minRows = 31;
        while (parsedItems.length < minRows) { parsedItems.push({ id: parsedItems.length + 1, title: '', outline: '' }); }
        setBulkItems(parsedItems);
    } else { alert("Không tìm thấy dữ liệu hợp lệ (Cần định dạng: Ngày | Tiêu đề | Mô tả)"); }
    setShowTextImport(false); setTextImportContent('');
  };


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || isParsingSheet) return;
    if (mode === 'single') {
        if (singleModeType === 'write') {
            onGenerate(prompt, writeLanguage);
        } else {
            onRemasterFromInput(remasterContent, remasterStyle, remasterLanguage);
        }
    } else {
      onGenerateBulk(
          bulkItems, 
          referenceImages, 
          currentAspectRatio, 
          currentCharacterOption, 
          bulkLength, 
          characterImages,
          false,
          imageStyle
      );
    }
  };

  const renderSingleForm = () => (
    <>
      <div className="flex bg-gray-900/40 p-1 rounded-lg mb-4">
        <button
            type="button"
            onClick={() => setSingleModeType('write')}
            className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${
                singleModeType === 'write' ? 'bg-sky-600 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
        >
            Viết Mới
        </button>
        <button
            type="button"
            onClick={() => setSingleModeType('remaster')}
            className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${
                singleModeType === 'remaster' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
        >
            Remaster (Viết Lại)
        </button>
      </div>

      {singleModeType === 'write' ? (
          <>
            <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                Độ dài mục tiêu
                </label>
                <div className="flex flex-wrap gap-2">
                {characterOptions.map((length) => (
                    <button
                    key={length}
                    type="button"
                    onClick={() => onLengthChange(length)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
                        selectedLength === length
                        ? 'bg-sky-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    >
                    {length.toLocaleString('vi-VN')} ký tự
                    </button>
                ))}
                </div>
            </div>
            <div>
                <label htmlFor="prompt" className="block text-sm font-medium text-gray-300 mb-2">
                Yêu cầu / Dàn ý chi tiết
                </label>
                <textarea
                id="prompt"
                rows={12}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-3 px-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Mô tả các ý chính, các chương, các luận điểm bạn muốn triển khai. Càng chi tiết, kết quả càng tốt.&#10;AI sẽ tự động tạo một tiêu đề hấp dẫn, chuẩn SEO cho bài viết của bạn."
                required
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-300 mb-2 mt-4">
                    Ngôn ngữ đầu ra
                </label>
                <div className="flex gap-4">
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="radio"
                            name="writeLanguage"
                            value="vi"
                            checked={writeLanguage === 'vi'}
                            onChange={() => setWriteLanguage('vi')}
                            className="form-radio h-4 w-4 text-sky-600 bg-gray-700 border-gray-600 focus:ring-sky-500"
                        />
                        <span className="text-sm text-gray-300">Tiếng Việt</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="radio"
                            name="writeLanguage"
                            value="en"
                            checked={writeLanguage === 'en'}
                            onChange={() => setWriteLanguage('en')}
                            className="form-radio h-4 w-4 text-sky-600 bg-gray-700 border-gray-600 focus:ring-sky-500"
                        />
                        <span className="text-sm text-gray-300">Tiếng Anh</span>
                    </label>
                </div>
            </div>
          </>
      ) : (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
             <div className="bg-indigo-900/20 border border-indigo-500/30 p-3 rounded-lg">
                <p className="text-xs text-indigo-200">
                    <span className="font-bold">✨ Chế độ Remaster:</span> Nhập nội dung bài viết gốc của bạn, AI sẽ viết lại hoàn toàn theo phong cách mới nhưng giữ nguyên ý nghĩa và độ dài.
                </p>
             </div>
             
             <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    Nội dung gốc (Nguyên liệu)
                </label>
                <textarea
                    rows={8}
                    value={remasterContent}
                    onChange={(e) => setRemasterContent(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-3 px-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Dán toàn bộ nội dung bài viết bạn muốn viết lại vào đây..."
                    required
                />
             </div>

             <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    Yêu cầu văn phong / Styles
                </label>
                <textarea
                    rows={3}
                    value={remasterStyle}
                    onChange={(e) => setRemasterStyle(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-3 px-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Ví dụ: Hài hước, châm biếm, học thuật, gần gũi như kể chuyện, dùng nhiều từ ngữ GenZ..."
                    required
                />
             </div>

             <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    Ngôn ngữ đầu ra
                </label>
                <div className="flex gap-4">
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="radio"
                            name="remasterLanguage"
                            value="vi"
                            checked={remasterLanguage === 'vi'}
                            onChange={() => setRemasterLanguage('vi')}
                            className="form-radio h-4 w-4 text-indigo-600 bg-gray-700 border-gray-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-gray-300">Tiếng Việt</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="radio"
                            name="remasterLanguage"
                            value="en"
                            checked={remasterLanguage === 'en'}
                            onChange={() => setRemasterLanguage('en')}
                            className="form-radio h-4 w-4 text-indigo-600 bg-gray-700 border-gray-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-gray-300">Tiếng Anh</span>
                    </label>
                </div>
             </div>
          </div>
      )}
    </>
  );

  const renderBulkForm = () => (
    <div className="flex flex-col h-full overflow-hidden relative">
        {/* Bulk Actions Header */}
        <div className="flex-shrink-0 mb-3 space-y-3">
            {/* Row 1: Sheet Upload, Text Import & Clear */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <div>
                         <label htmlFor="sheet-upload" className={`inline-flex items-center justify-center px-3 py-1.5 border border-gray-600 text-xs font-medium rounded-md text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors cursor-pointer ${isParsingSheet ? 'opacity-50 cursor-not-allowed' : ''}`}>
                             <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 mr-1.5 ${isParsingSheet ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                                {isParsingSheet ? (
                                     <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v4a1 1 0 102 0V5z" clipRule="evenodd" />
                                ): (
                                    <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h14a1 1 0 001-1V4a1 1 0 00-1-1H3zm2 2v2h2V5H5zm4 0v2h2V5H9zm4 0v2h2V5H9zm4 0v2h2V5H9zm4 0v2h2V9h-2zM5 9v2h2V9H5zm4 0v2h2V9H9zm4 0v2h2V9H9zm4 0v2h2V9H9zm4 0v2h2V9H9zm4 0v2h2V9H9zm4 0v2h2V9H9zm4 0v2h2V9H9zm4 0v2h2V9h-2zm-4 4v2h2v-2H9zm-4 0v2h2v-2H5zm8 0v2h2v-2h-2z" clipRule="evenodd" />
                                )}
                             </svg>
                            {isParsingSheet ? 'Đang đọc...' : 'Tải lên (XLSX, PDF)'}
                        </label>
                        <input
                            id="sheet-upload"
                            type="file"
                            accept=".xlsx, .xls, .csv, .txt, .pdf, application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                            onChange={handleSheetUpload}
                            className="hidden"
                            disabled={isParsingSheet}
                        />
                    </div>
                    
                    <button
                        type="button"
                        onClick={() => setShowTextImport(true)}
                        className="inline-flex items-center px-3 py-1.5 border border-gray-600 text-xs font-medium rounded-md text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors"
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 3.414L15.586 7A2 2 0 0116 8.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                        </svg>
                        Nhập Code Block
                    </button>
                </div>
                 <button
                  type="button"
                  onClick={handleClearAllBulkItems}
                  disabled={isLoading || isParsingSheet}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-600 text-xs font-medium rounded-md text-red-400 bg-gray-700 hover:bg-red-900/50 hover:border-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  Xóa toàn bộ
                </button>
            </div>
            
            {/* Row 2: Image Settings - LIST VIEW */}
            <div className="bg-gray-700/30 p-2 rounded-lg border border-gray-600/50">
                <div className="mb-2">
                    <p className="text-xs font-medium text-sky-400 mb-1 flex items-center justify-between">
                        <span className="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                            </svg>
                            Cài đặt Ảnh Minh Họa
                        </span>
                    </p>
                    
                    <div className="flex flex-col gap-2">
                        {/* Reference Image Input List */}
                        <div className="w-full">
                            <label className="block text-[10px] text-gray-500 mb-1">Ảnh sản phẩm (Có thể thêm nhiều)</label>
                            <div className="flex flex-wrap gap-2">
                                {/* Upload Button */}
                                <div className="relative h-[40px] w-[100px]">
                                    <input 
                                        ref={refInputRef}
                                        type="file" 
                                        accept="image/*"
                                        onChange={handleImageUpload}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                        title="Thêm ảnh sản phẩm"
                                    />
                                    <div className="flex items-center justify-center w-full h-full bg-gray-700 border border-dashed border-gray-500 rounded hover:bg-gray-600 text-gray-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                                        </svg>
                                        <span className="text-[10px]">Thêm ảnh</span>
                                    </div>
                                </div>

                                {/* List of Uploaded Images */}
                                {referenceImages.map((img) => (
                                    <div key={img.id} className="flex items-center bg-gray-800 border border-gray-600 rounded p-1 h-[40px] max-w-[200px] gap-2">
                                         <img 
                                            src={`data:image/png;base64,${img.base64}`} 
                                            alt="Ref" 
                                            className="h-full w-auto rounded-sm object-cover aspect-square border border-gray-500"
                                        />
                                        <input 
                                            type="text"
                                            value={img.keyword}
                                            onChange={(e) => onUpdateReferenceKeyword(img.id, e.target.value)}
                                            placeholder="Từ khóa (vd: Vitamin)"
                                            className="flex-1 min-w-0 bg-transparent text-[10px] text-gray-200 placeholder-gray-500 focus:outline-none h-full border-l border-gray-700 pl-1"
                                        />
                                        <button 
                                            type="button" 
                                            onClick={() => onRemoveReferenceImage(img.id)}
                                            className="text-gray-400 hover:text-red-400 p-0.5 hover:bg-gray-700 rounded transition-colors"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Flex wrap container for remaining controls to ensure no overflow/loss on mobile */}
                        <div className="flex flex-wrap gap-2 w-full items-end mt-1">
                            {/* Character Image Input List */}
                            <div className="flex-grow min-w-[150px]">
                                <label className="block text-[10px] text-gray-500 mb-1">Ảnh nhân vật (Khuôn mặt)</label>
                                <div className="flex flex-wrap gap-2">
                                    {/* Upload Button */}
                                    <div className="relative h-[30px] w-[80px]">
                                        <input 
                                            ref={charInputRef}
                                            type="file" 
                                            accept="image/*"
                                            onChange={handleCharacterImageUpload}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            title="Thêm ảnh nhân vật"
                                        />
                                        <div className="flex items-center justify-center w-full h-full bg-gray-700 border border-dashed border-gray-500 rounded hover:bg-gray-600 text-gray-400">
                                            <span className="text-[10px]">+ Khuôn mặt</span>
                                        </div>
                                    </div>

                                     {/* List of Uploaded Characters */}
                                    {characterImages.map((img) => (
                                        <div key={img.id} className="relative h-[30px] w-[30px] group">
                                             <img 
                                                src={`data:image/png;base64,${img.base64}`} 
                                                alt="Char" 
                                                className="h-full w-full rounded-sm object-cover border border-gray-500"
                                            />
                                            <button 
                                                type="button" 
                                                onClick={() => onRemoveCharacterImage(img.id)}
                                                className="absolute -top-1 -right-1 bg-gray-900 text-red-400 rounded-full p-0.5 border border-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-2 w-2" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Image Style Selection (NEW) */}
                            <div className="w-[80px]">
                                <label className="block text-[10px] text-gray-500 mb-1">Phong cách</label>
                                <select 
                                    value={imageStyle} 
                                    onChange={(e) => onImageStyleChange(e.target.value as ImageStyle)}
                                    className="w-full bg-gray-800 border border-gray-600 text-[10px] rounded px-1 py-1 focus:ring-1 focus:ring-sky-500 outline-none text-gray-200 h-[30px]"
                                >
                                    <option value="realistic">Chân thực</option>
                                    <option value="cartoon">Hoạt hình</option>
                                </select>
                            </div>

                            {/* Aspect Ratio */}
                            <div className="w-[60px]">
                                <label className="block text-[10px] text-gray-500 mb-1">Tỷ lệ</label>
                                <select 
                                    value={currentAspectRatio} 
                                    onChange={(e) => onAspectRatioChange(e.target.value as AspectRatio)}
                                    className="w-full bg-gray-800 border border-gray-600 text-[10px] rounded px-1 py-1 focus:ring-1 focus:ring-sky-500 outline-none text-gray-200 h-[30px]"
                                >
                                    <option value="16:9">16:9</option>
                                    <option value="1:1">1:1</option>
                                    <option value="9:16">9:16</option>
                                    <option value="4:3">4:3</option>
                                    <option value="3:4">3:4</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="border-t border-gray-600/50 pt-2 flex items-center justify-between">
                     <div className="flex items-center">
                        <span className="text-xs font-medium text-sky-400 mr-2">Độ dài:</span>
                        <div className="flex gap-1">
                            {bulkLengthOptions.map((length) => (
                                <button
                                    key={length}
                                    type="button"
                                    onClick={() => setBulkLength(length)}
                                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors border ${
                                        bulkLength === length
                                        ? 'bg-sky-600 border-sky-600 text-white'
                                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                                    }`}
                                >
                                    {length >= 1000 ? `${length/1000}k` : length}
                                </button>
                            ))}
                        </div>
                     </div>
                     <button
                        type="submit"
                        disabled={isLoading}
                        className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white text-xs font-bold rounded shadow-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Đang tạo...' : 'Tạo hàng loạt'}
                    </button>
                </div>
            </div>
        </div>

      {/* Compact Table Header */}
      <div className="flex items-center gap-2 px-2 py-1 text-xs font-bold text-gray-400 border-b border-gray-700 bg-gray-800/50">
          <div className="w-6 text-center">#</div>
          <div className="flex-1">Tiêu đề bài viết</div>
          <div className="flex-1">Dàn ý / Mô tả</div>
          <div className="w-6"></div>
      </div>

      {/* Scrollable Compact List */}
      <div className="flex-grow overflow-y-auto pr-1 -mr-1 min-h-0 bg-gray-900/30 rounded-b-md">
        {bulkItems.map((item) => (
          <div key={item.id} className="flex items-center gap-2 p-1 border-b border-gray-700/50 hover:bg-gray-800/50 transition-colors group">
                <div className="w-6 flex-shrink-0 text-center">
                    <span className="text-[10px] text-gray-500 font-mono">
                        {item.id}
                    </span>
                </div>
                <div className="flex-1 min-w-0">
                    <input
                        type="text"
                        placeholder="Tiêu đề..."
                        value={item.title}
                        onChange={(e) => handleBulkItemChange(item.id, 'title', e.target.value)}
                        className="w-full bg-transparent border-none p-1 text-base sm:text-xs text-gray-200 placeholder-gray-600 focus:ring-0 focus:bg-gray-800/50 rounded"
                        disabled={isLoading}
                    />
                </div>
                <div className="flex-1 min-w-0">
                     <input
                        type="text"
                        placeholder="Dàn ý..."
                        value={item.outline}
                        onChange={(e) => handleBulkItemChange(item.id, 'outline', e.target.value)}
                        className="w-full bg-transparent border-none p-1 text-base sm:text-xs text-gray-300 placeholder-gray-600 focus:ring-0 focus:bg-gray-800/50 rounded"
                        disabled={isLoading}
                    />
                </div>
                <div className="w-6 flex-shrink-0 flex justify-center">
                     <button
                        type="button"
                        onClick={() => handleClearBulkItem(item.id)}
                        className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        title="Xóa dòng và đẩy lên"
                        disabled={isLoading}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
          </div>
        ))}
      </div>

       {/* Text Import Modal - Optimized for Mobile Fullscreen */}
        {showTextImport && (
            <div className="fixed inset-0 bg-black/80 z-[100] flex justify-center sm:items-center sm:p-4">
                <div className="bg-gray-900 flex flex-col shadow-2xl border-gray-700 w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-lg sm:border">
                    <div className="flex justify-between items-center p-3 border-b border-gray-700 flex-shrink-0 bg-gray-800/50 sm:rounded-t-lg">
                        <h3 className="text-sm font-bold text-sky-400 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                            Nhập Code Block
                        </h3>
                        <button 
                            onClick={() => setShowTextImport(false)}
                            className="text-gray-400 hover:text-white p-2 hover:bg-gray-700 rounded-full"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                        </button>
                    </div>
                    
                    <div className="flex-1 p-3 min-h-0 flex flex-col">
                        <div className="mb-2 flex-shrink-0 flex items-center justify-between text-[10px] sm:text-xs text-gray-500">
                            <span>Ngăn cách các cột bởi dấu gạch đứng |</span>
                            <span>Ví dụ: Tiêu đề | Nội dung</span>
                        </div>
                        <textarea 
                            className="w-full flex-1 bg-gray-950 border border-gray-700 rounded-md p-3 text-base sm:text-xs font-mono text-gray-300 focus:ring-1 focus:ring-sky-500 focus:outline-none resize-none overflow-y-auto"
                            placeholder={`Dán nội dung vào đây...\n\nĐịnh dạng:\nNgày | Tiêu đề | Mô tả\n\nVí dụ:\n20/10 | Món quà ý nghĩa | Tặng mẹ một món quà...`}
                            value={textImportContent}
                            onChange={(e) => setTextImportContent(e.target.value)}
                        />
                    </div>
                    
                    <div className="flex justify-end gap-2 p-3 border-t border-gray-700 flex-shrink-0 bg-gray-800 sm:rounded-b-lg pb-safe">
                        <button
                            type="button"
                            onClick={() => setShowTextImport(false)}
                            className="px-4 py-2 text-sm sm:text-xs font-medium text-gray-300 hover:bg-gray-700 rounded border border-gray-600"
                        >
                            Hủy
                        </button>
                        <button
                            type="button"
                            onClick={handleTextImportSubmit}
                            className="px-4 py-2 text-sm sm:text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded shadow-sm flex items-center"
                        >
                            <span>Xử lý dữ liệu</span>
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full bg-gray-800/50 p-4 rounded-xl shadow-lg border border-gray-700 overflow-hidden">
      {mode === 'single' ? (
        <div className="flex flex-col h-full">
            <div className="space-y-4 flex-grow overflow-y-auto pr-2 custom-scrollbar">
                {renderSingleForm()}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-700 flex justify-end flex-shrink-0">
                <button
                    type="submit"
                    disabled={isLoading}
                    className={`inline-flex items-center px-6 py-3 font-bold rounded-lg shadow-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${
                        singleModeType === 'write' 
                            ? 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white' 
                            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white'
                    }`}
                >
                    {isLoading ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {singleModeType === 'write' ? 'Đang viết bài...' : 'Đang viết lại...'}
                        </>
                    ) : (
                        <>
                            {singleModeType === 'write' ? (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                    Viết bài ngay
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Remaster Ngay
                                </>
                            )}
                        </>
                    )}
                </button>
            </div>
        </div>
      ) : (
        renderBulkForm()
      )}
    </form>
  );
};

export default ArticleForm;

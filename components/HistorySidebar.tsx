
import React, { useEffect, useState } from 'react';
import { HistoryRecord } from '../types';
import { getHistory, deleteHistoryItem, clearHistory } from '../services/historyService';

interface HistorySidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onRestore: (item: HistoryRecord) => void;
}

const HistorySidebar: React.FC<HistorySidebarProps> = ({ isOpen, onClose, onRestore }) => {
    const [history, setHistory] = useState<HistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadHistory();
        }
    }, [isOpen]);

    const loadHistory = async () => {
        setIsLoading(true);
        try {
            const data = await getHistory();
            setHistory(data);
        } catch (error) {
            console.error("Failed to load history:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (window.confirm("Bạn có chắc muốn xóa mục này?")) {
            await deleteHistoryItem(id);
            await loadHistory();
        }
    };

    const handleClearAll = async () => {
        if (window.confirm("Bạn có chắc muốn xóa toàn bộ lịch sử không? Hành động này không thể hoàn tác.")) {
            await clearHistory();
            setHistory([]);
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-black/50 z-40 transition-opacity"
                    onClick={onClose}
                />
            )}
            
            {/* Sidebar Panel */}
            <div className={`fixed top-0 left-0 h-full w-80 bg-gray-900 border-r border-gray-700 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800">
                        <h2 className="text-lg font-bold text-sky-400 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                            </svg>
                            Lịch sử
                        </h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* List */}
                    <div className="flex-grow overflow-y-auto p-2 space-y-2">
                        {isLoading ? (
                            <div className="text-center text-gray-400 mt-10">
                                <svg className="animate-spin h-6 w-6 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Đang tải...
                            </div>
                        ) : history.length === 0 ? (
                            <div className="text-center text-gray-500 mt-10 text-sm">
                                Chưa có lịch sử nào được lưu.
                            </div>
                        ) : (
                            history.map(item => (
                                <div 
                                    key={item.id} 
                                    onClick={() => onRestore(item)}
                                    className="bg-gray-800 p-3 rounded-md border border-gray-700 hover:bg-gray-700 cursor-pointer group transition-colors relative"
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${item.mode === 'single' ? 'bg-indigo-900 text-indigo-300' : 'bg-teal-900 text-teal-300'}`}>
                                            {item.mode === 'single' ? 'Bài Đơn' : 'Hàng Loạt'}
                                        </span>
                                        <span className="text-[10px] text-gray-500">{formatDate(item.timestamp)}</span>
                                    </div>
                                    <h3 className="text-sm text-gray-200 font-medium line-clamp-2 leading-snug">
                                        {item.title}
                                    </h3>
                                    
                                    <button 
                                        onClick={(e) => handleDelete(e, item.id)}
                                        className="absolute bottom-2 right-2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-gray-800 rounded-full shadow-sm z-10"
                                        title="Xóa"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Footer */}
                    {history.length > 0 && (
                        <div className="p-3 border-t border-gray-700 bg-gray-800">
                            <button 
                                onClick={handleClearAll}
                                className="w-full py-2 text-xs font-bold text-red-400 hover:bg-red-900/20 rounded transition-colors"
                            >
                                Xóa toàn bộ lịch sử
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default HistorySidebar;

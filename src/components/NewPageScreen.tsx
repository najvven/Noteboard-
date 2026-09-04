import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Preset } from '../types';
import { X, Sparkles, Files, Settings2, LayoutTemplate, ChevronDown, ChevronRight, Info } from 'lucide-react';

interface Props {
  userPresets: Preset[];
  onStart: (title: string, width: number, height: number, workspaceWidth: number, workspaceHeight: number, snapToGrid: boolean, preset: Preset | null) => void;
  onBack: () => void;
  onDeletePreset?: (id: string) => void;
  onRenamePreset?: (id: string, newName: string) => void;
}

export default function NewPageScreen({ userPresets, onStart, onBack, onDeletePreset, onRenamePreset }: Props) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState<number | string>(800);
  const [height, setHeight] = useState<number | string>(600);
  const [workspaceWidth, setWorkspaceWidth] = useState<number | string>(10000);
  const [workspaceHeight, setWorkspaceHeight] = useState<number | string>(10000);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleStart = (preset: Preset | null = null) => {
    onStart(
      name,
      Number(width) || 800,
      Number(height) || 600,
      Number(workspaceWidth) || 10000,
      Number(workspaceHeight) || 10000,
      false,
      preset
    );
  };

  const sizeInfo = (
    <span
      className="group relative inline-flex shrink-0"
      tabIndex={0}
      aria-label="Board/workspace dimensions use pixels"
      title="Board/workspace dimensions use pixels."
    >
      <Info
        className="h-3.5 w-3.5 text-gray-400 transition-colors group-hover:text-gray-700 group-focus:text-gray-700"
        aria-hidden="true"
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-[200] mb-1 hidden w-40 max-w-[calc(100vw-2rem)] -translate-x-1/2 whitespace-normal break-words rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-left text-[10px] font-medium leading-snug normal-case tracking-normal text-white shadow-lg group-hover:block group-focus:block"
      >
        Board/workspace dimensions use pixels.
      </span>
    </span>
  );

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-noteboard-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 xl:p-8 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        data-new-noteboard-dialog="true"
        className="bg-white shadow-2xl rounded-3xl border-2 border-gray-800 overflow-hidden flex h-[min(680px,90vh)] min-h-0 w-full max-w-5xl max-h-[90vh] flex-col animate-in zoom-in-95 duration-200"
      >
        <div className="p-6 border-b-4 border-gray-100 flex justify-between items-center bg-white shrink-0">
          <h2 id="new-noteboard-title" className="text-xl font-bold tracking-tight text-[#1A1A1A]">Create New Noteboard</h2>
          <button onClick={onBack} aria-label="Close new noteboard dialog" className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-black transition-colors border-2 border-transparent hover:border-gray-300">
             <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* Left panel: Settings */}
          <div data-new-noteboard-settings-panel="true" className="relative z-10 flex min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto border-r-4 border-gray-100 bg-gray-50 p-6 md:w-1/3 xl:w-1/4 xl:p-8">
            <h3 className="mb-6 -mt-4 flex items-center gap-2 text-base font-bold text-gray-800">
              <Settings2 className="w-5 h-5" /> Board Settings
            </h3>
            
            <div className="space-y-6 flex-1">
              <div>
                <label htmlFor="new-noteboard-name" className="mb-2 block text-xs font-bold text-gray-700">Noteboard Name</label>
                <input id="new-noteboard-name" type="text" placeholder="" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:border-black focus:ring-black outline-none font-bold transition-colors" />
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  data-size-toggle="true"
                  aria-expanded={showAdvanced}
                  aria-controls="new-noteboard-size-fields"
                  className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-black transition-colors"
                >
                  {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Size
                </button>
                {sizeInfo}
              </div>

              <div
                id="new-noteboard-size-fields"
                data-size-fields="true"
                hidden={!showAdvanced}
                className="space-y-4 animate-in fade-in slide-in-from-top-2"
              >
                <div className="mt-4 flex gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-2 block whitespace-nowrap text-xs font-bold text-gray-700">Board Width</label>
                    <input type="number" min="100" max="100000" value={width} onChange={e => setWidth(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:border-black focus:ring-black outline-none font-bold transition-colors" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="mb-2 block whitespace-nowrap text-xs font-bold text-gray-700">Board Height</label>
                    <input type="number" min="100" max="100000" value={height} onChange={e => setHeight(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:border-black focus:ring-black outline-none font-bold transition-colors" />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4">
                  <div>
                    <label className="mb-2 block whitespace-nowrap text-xs font-bold text-gray-700">Workspace Width</label>
                    <input type="number" min="1000" max="1000000" value={workspaceWidth} onChange={e => setWorkspaceWidth(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:border-black focus:ring-black outline-none font-bold transition-colors" />
                  </div>
                  <div>
                    <label className="mb-2 block whitespace-nowrap text-xs font-bold text-gray-700">Workspace Height</label>
                    <input type="number" min="1000" max="1000000" value={workspaceHeight} onChange={e => setWorkspaceHeight(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:border-black focus:ring-black outline-none font-bold transition-colors" />
                  </div>
                </div>
              </div>
            </div>

             <button onClick={() => handleStart()} className="w-full mt-8 p-3 bg-black text-white rounded-xl hover:bg-gray-800 transition-all font-bold border-2 border-black flex items-center justify-center gap-2">
               <Files className="w-4 h-4" />
               Create Noteboard
             </button>
          </div>

          {/* Right panel: Templates */}
          <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto bg-white p-6 xl:p-8">
            <div>
              <h3 className="font-bold text-gray-800 mb-4 text-sm flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4" /> Templates
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                <div 
                  onClick={() => handleStart()}
                  className="col-span-1 p-4 border-[1.5px] border-blue-500 bg-blue-50/30 rounded-2xl flex flex-col items-center justify-center text-center group cursor-pointer transition-all hover:bg-blue-50/50 py-8 relative overflow-hidden"
                >
                  <div className="w-12 h-12 bg-white rounded-xl shadow-sm border-2 border-blue-100 flex items-center justify-center mb-3">
                     <Files className="w-6 h-6 text-blue-500" />
                  </div>
                  <span className="text-sm font-bold text-[#1A1A1A]">Default</span>
                  <span className="text-[10px] font-bold text-blue-600/70 mt-1 uppercase tracking-wider">Current Settings</span>
                  <div className="absolute inset-0 border-4 border-transparent group-hover:border-blue-100 rounded-2xl transition-all" style={{ pointerEvents: 'none' }} />
                </div>

                {userPresets.map(preset => (
                  <div 
                    key={preset.id} 
                    className="col-span-1 border border-gray-200 rounded-2xl flex flex-col group transition-all hover:border-gray-400 relative overflow-hidden bg-white"
                  >
                    <button 
                       className="absolute top-2 right-2 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all z-10"
                       onClick={(e) => { e.stopPropagation(); onDeletePreset && onDeletePreset(preset.id); }}
                    >
                       <X className="w-4 h-4" />
                    </button>
                    
                    <div 
                      onClick={() => handleStart(preset)}
                      className="flex flex-col items-center justify-center text-center p-4 py-8 cursor-pointer flex-1"
                    >
                      <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-gray-500 mb-3 border-2 border-gray-200">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      
                      <input 
                         className="text-sm font-bold text-[#1A1A1A] w-full text-center bg-transparent border-none border-b-2 border-transparent hover:border-gray-300 focus:border-blue-500 outline-none mb-1 transition-colors px-1"
                         value={preset.name}
                         onClick={(e) => e.stopPropagation()}
                         onChange={(e) => onRenamePreset && onRenamePreset(preset.id, e.target.value)}
                         title="Edit name"
                      />
                      <span className="text-[10px] text-gray-500 truncate w-full px-2" title={preset.description}>{preset.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {userPresets.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-white">
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // The app shell can be filtered for global brightness. A filter creates a
  // containing block for fixed descendants, which would make this overlay
  // track the scrolled Home screen instead of the viewport.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

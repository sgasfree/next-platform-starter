'use client';

import { useRef, useCallback } from 'react';

export function DiffFigure({ children }) {
    const containerRef = useRef(null);
    const resizerRef = useRef(null);

    const updateSlider = useCallback((clientX) => {
        if (!containerRef.current || !resizerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const pct = Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100));
        resizerRef.current.style.width = `${pct}%`;
    }, []);

    return (
        <figure
            ref={containerRef}
            className="relative grid w-full overflow-hidden border-2 border-white rounded-lg select-none diff aspect-3/2"
            tabIndex="0"
        >
            {children}
            <div
                ref={resizerRef}
                className="relative h-2 col-start-1 row-start-1 overflow-hidden opacity-0 diff-resizer z-1 min-w-4 cursor-ew-resize touch-none top-1/2"
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updateSlider(e.clientX);
                }}
                onPointerMove={(e) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    updateSlider(e.clientX);
                }}
            />
        </figure>
    );
}

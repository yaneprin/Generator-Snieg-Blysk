/**
 * Snow Sparkle Generator - Moduł Łączenia Wideo i Zdjęć w jedno MP4
 * Umożliwia wgrywanie zdjęć, grafik 2D i wideo, układanie ich na osi czasu (timeline),
 * rozciąganie czasu trwania grafik/zdjęć, edycję czasu trwania, przesuwanie osi
 * oraz eksport do jednego spójnego pliku MP4 w wybranej rozdzielczości.
 */

(function () {
    'use strict';

    // Stan modułu łączenia
    const joinerState = {
        files: [],            // { id, name, type: 'image'|'video', file, url, width, height, naturalDuration, thumbnail }
        timelineClips: [],    // { id, fileId, name, type, url, width, height, duration, thumbnail }
        selectedClipId: null,
        playback: {
            currentTime: 0,
            isPlaying: false,
            animId: null,
            lastTimestamp: 0
        },
        timeline: {
            pxPerSec: 60,     // Skala osi: piksele na sekundę
            minPxPerSec: 20,
            maxPxPerSec: 200,
            isDraggingPlayhead: false,
            resizingClip: null,
            dragStartX: 0,
            initialDuration: 0
        },
        export: {
            isExporting: false,
            cancelRequested: false,
            recorder: null,
            stream: null,
            resultBlob: null
        },
        videoElementsCache: new Map() // url -> HTMLVideoElement
    };

    // Inicjalizacja po załadowaniu DOM
    document.addEventListener('DOMContentLoaded', () => {
        setupJoinerViewToggle();
        setupJoinerUpload();
        setupJoinerControls();
        setupJoinerTimelineEvents();
        setupJoinerExport();
    });

    /* =========================================================================
     * 1. NAWIGACJA: OTWIERANIE I ZAMYKANIE PODSTRONY
     * ========================================================================= */
    function setupJoinerViewToggle() {
        const btnOpen = document.getElementById('btn-open-video-joiner');
        const btnBack = document.getElementById('btn-joiner-back');
        const joinerView = document.getElementById('video-joiner-view');
        const appHeader = document.querySelector('.app-header');
        const appMain = document.querySelector('.app-main');

        if (btnOpen) {
            btnOpen.addEventListener('click', () => {
                openJoinerView();
            });
        }

        if (btnBack) {
            btnBack.addEventListener('click', () => {
                closeJoinerView();
            });
        }

        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.view === 'joiner') {
                showJoinerUI(true);
            } else {
                showJoinerUI(false);
            }
        });

        // Obsługa skrótu spacji do odtwarzania w widoku łączenia
        window.addEventListener('keydown', (e) => {
            if (joinerView && joinerView.style.display !== 'none') {
                if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    togglePlayback();
                }
            }
        });
    }

    function openJoinerView() {
        window.history.pushState({ view: 'joiner' }, '', '#joiner');
        showJoinerUI(true);
    }

    function closeJoinerView() {
        if (joinerState.playback.isPlaying) {
            pausePlayback();
        }
        if (window.location.hash === '#joiner') {
            window.history.pushState({}, '', window.location.pathname);
        }
        showJoinerUI(false);
    }

    function showJoinerUI(show) {
        const joinerView = document.getElementById('video-joiner-view');
        const appHeader = document.querySelector('.app-header');
        const appMain = document.querySelector('.app-main');

        if (!joinerView || !appHeader || !appMain) return;

        if (show) {
            appHeader.style.display = 'none';
            appMain.style.display = 'none';
            joinerView.style.display = 'flex';
            setTimeout(() => {
                renderTimeline();
                renderRuler();
                updatePreviewFrame();
            }, 50);
        } else {
            joinerView.style.display = 'none';
            appHeader.style.display = 'flex';
            appMain.style.display = 'grid';
        }
    }

    /* =========================================================================
     * 2. OBSŁUGA WGRYWANIA PLIKÓW (UPLOAD & DRAG-AND-DROP)
     * ========================================================================= */
    function setupJoinerUpload() {
        const dropzone = document.getElementById('joiner-dropzone');
        const fileInput = document.getElementById('joiner-file-input');
        const btnBrowse = document.getElementById('btn-browse-joiner-files');
        const btnClearFiles = document.getElementById('btn-clear-joiner-files');

        if (btnBrowse && fileInput) {
            btnBrowse.addEventListener('click', () => fileInput.click());
        }

        if (dropzone && fileInput) {
            dropzone.addEventListener('click', (e) => {
                if (e.target !== btnBrowse) fileInput.click();
            });

            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('dragover');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                    const files = Array.from(e.dataTransfer.files);
                    handleUploadedFiles(files);
                }
            });

            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    const files = Array.from(e.target.files);
                    fileInput.value = ''; // Reset, aby można było wybrać ponownie ten sam plik
                    handleUploadedFiles(files);
                }
            });
        }

        if (btnClearFiles) {
            btnClearFiles.addEventListener('click', () => {
                if (joinerState.files.length === 0) return;
                if (confirm('Czy na pewno chcesz usunąć wszystkie wgrane pliki z biblioteki?')) {
                    joinerState.files = [];
                    updateFilesListUI();
                    updateOriginalResolutionOption();
                }
            });
        }
    }

    async function handleUploadedFiles(fileList) {
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name);
            const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg|bmp)$/i.test(file.name);

            if (!isVideo && !isImage) continue;

            const fileUrl = URL.createObjectURL(file);
            const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

            if (isImage) {
                try {
                    const imgMeta = await loadImageMetadata(fileUrl);
                    joinerState.files.push({
                        id: fileId,
                        name: file.name,
                        type: 'image',
                        file: file,
                        url: fileUrl,
                        width: imgMeta.width,
                        height: imgMeta.height,
                        naturalDuration: 3.0, // Domyślny czas dla zdjęć i grafik: 3 sekundy
                        thumbnail: imgMeta.thumbnail
                    });
                } catch (err) {
                    console.error('Błąd wczytywania obrazu:', err);
                }
            } else if (isVideo) {
                try {
                    const vidMeta = await loadVideoMetadata(fileUrl);
                    joinerState.files.push({
                        id: fileId,
                        name: file.name,
                        type: 'video',
                        file: file,
                        url: fileUrl,
                        width: vidMeta.width,
                        height: vidMeta.height,
                        naturalDuration: vidMeta.duration,
                        thumbnail: vidMeta.thumbnail
                    });
                } catch (err) {
                    console.error('Błąd wczytywania wideo:', err);
                }
            }
        }

        updateFilesListUI();
        updateOriginalResolutionOption();
    }

    function loadImageMetadata(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const w = img.naturalWidth || 1920;
                const h = img.naturalHeight || 1080;
                // Generowanie miniatury na małym płótnie canvas
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = 100;
                thumbCanvas.height = Math.round(100 * (h / w));
                const ctx = thumbCanvas.getContext('2d');
                ctx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
                const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);
                resolve({ width: w, height: h, thumbnail });
            };
            img.onerror = reject;
            img.src = url;
        });
    }

    function loadVideoMetadata(url) {
        return new Promise((resolve, reject) => {
            const vid = document.createElement('video');
            vid.muted = true;
            vid.playsInline = true;
            vid.crossOrigin = 'anonymous';
            vid.preload = 'metadata';

            vid.onloadedmetadata = () => {
                const w = vid.videoWidth || 1920;
                const h = vid.videoHeight || 1080;
                const duration = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 5.0;

                vid.currentTime = Math.min(0.5, duration / 2);
            };

            vid.onseeked = () => {
                const w = vid.videoWidth || 1920;
                const h = vid.videoHeight || 1080;
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = 100;
                thumbCanvas.height = Math.round(100 * (h / w));
                const ctx = thumbCanvas.getContext('2d');
                ctx.drawImage(vid, 0, 0, thumbCanvas.width, thumbCanvas.height);
                const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);

                joinerState.videoElementsCache.set(url, vid);
                resolve({
                    width: w,
                    height: h,
                    duration: (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 5.0,
                    thumbnail
                });
            };

            vid.onerror = reject;
            vid.src = url;
        });
    }

    function updateFilesListUI() {
        const container = document.getElementById('joiner-files-list');
        const countBadge = document.getElementById('joiner-files-count');
        if (!container) return;

        if (countBadge) {
            countBadge.textContent = joinerState.files.length;
        }

        if (joinerState.files.length === 0) {
            container.innerHTML = '<div class="joiner-empty-hint">Brak wgranych plików. Wgraj zdjęcia lub wideo powyżej.</div>';
            return;
        }

        container.innerHTML = '';
        joinerState.files.forEach((fileItem, idx) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'joiner-file-item';
            itemEl.title = `Podwójne kliknięcie: dodaj "${fileItem.name}" na oś czasu`;

            const numSpan = document.createElement('span');
            numSpan.className = 'joiner-file-num';
            numSpan.textContent = `${idx + 1}.`;

            const thumbImg = document.createElement('img');
            thumbImg.className = 'joiner-file-thumb';
            thumbImg.src = fileItem.thumbnail || '';
            thumbImg.alt = fileItem.name;

            const infoDiv = document.createElement('div');
            infoDiv.className = 'joiner-file-info';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'joiner-file-name';
            nameDiv.textContent = fileItem.name;

            const metaDiv = document.createElement('div');
            metaDiv.className = 'joiner-file-meta';
            const typeLabel = fileItem.type === 'video' ? '🎬 Wideo' : '🖼️ Obraz';
            const durLabel = fileItem.type === 'video' ? `${fileItem.naturalDuration.toFixed(1)}s` : '3.0s';
            metaDiv.textContent = `${typeLabel} | ${fileItem.width}×${fileItem.height} | ${durLabel}`;

            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(metaDiv);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'joiner-file-actions';

            const btnAdd = document.createElement('button');
            btnAdd.className = 'btn btn-secondary btn-xs';
            btnAdd.textContent = '+ Dodaj';
            btnAdd.title = 'Dodaj ten plik na oś czasu';
            btnAdd.addEventListener('click', (e) => {
                e.stopPropagation();
                addClipToTimeline(fileItem);
            });

            const btnDel = document.createElement('button');
            btnDel.className = 'btn btn-secondary btn-xs';
            btnDel.textContent = '✕';
            btnDel.title = 'Usuń plik z biblioteki';
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFileFromLibrary(fileItem.id);
            });

            actionsDiv.appendChild(btnAdd);
            actionsDiv.appendChild(btnDel);

            itemEl.appendChild(numSpan);
            itemEl.appendChild(thumbImg);
            itemEl.appendChild(infoDiv);
            itemEl.appendChild(actionsDiv);

            // Podwójne kliknięcie dodaje plik na timeline
            itemEl.addEventListener('dblclick', () => {
                addClipToTimeline(fileItem);
            });

            container.appendChild(itemEl);
        });
    }

    function removeFileFromLibrary(fileId) {
        joinerState.files = joinerState.files.filter(f => f.id !== fileId);
        updateFilesListUI();
        updateOriginalResolutionOption();
    }

    function updateOriginalResolutionOption() {
        const optOriginal = document.getElementById('joiner-opt-original');
        if (!optOriginal) return;

        if (joinerState.files.length === 0) {
            optOriginal.textContent = 'Oryginalna (największy plik): Brak plików';
            return;
        }

        let maxW = 0;
        let maxH = 0;
        joinerState.files.forEach(f => {
            if (f.width > maxW) maxW = f.width;
            if (f.height > maxH) maxH = f.height;
        });

        optOriginal.textContent = `Oryginalna (największy plik): ${maxW} x ${maxH}`;
    }

    /* =========================================================================
     * 3. OŚ CZASU (TIMELINE) & ZARZĄDZANIE KLIPAMI
     * ========================================================================= */
    function addClipToTimeline(fileItem) {
        const clipId = 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const duration = fileItem.type === 'video' ? fileItem.naturalDuration : 3.0;

        const newClip = {
            id: clipId,
            fileId: fileItem.id,
            name: fileItem.name,
            type: fileItem.type,
            url: fileItem.url,
            width: fileItem.width,
            height: fileItem.height,
            naturalDuration: fileItem.naturalDuration,
            duration: Math.max(0.1, Math.round(duration * 10) / 10),
            thumbnail: fileItem.thumbnail
        };

        joinerState.timelineClips.push(newClip);
        selectClip(newClip.id);
        renderTimeline();
        renderRuler();
        updateTimelineStats();
        updatePreviewFrame();
    }

    function removeClipFromTimeline(clipId) {
        joinerState.timelineClips = joinerState.timelineClips.filter(c => c.id !== clipId);
        if (joinerState.selectedClipId === clipId) {
            joinerState.selectedClipId = null;
            hideClipInspector();
        }
        renderTimeline();
        renderRuler();
        updateTimelineStats();
        updatePreviewFrame();
    }

    function moveClip(clipId, direction) {
        const idx = joinerState.timelineClips.findIndex(c => c.id === clipId);
        if (idx === -1) return;

        const targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= joinerState.timelineClips.length) return;

        const temp = joinerState.timelineClips[idx];
        joinerState.timelineClips[idx] = joinerState.timelineClips[targetIdx];
        joinerState.timelineClips[targetIdx] = temp;

        renderTimeline();
        renderRuler();
        updateTimelineStats();
        updatePreviewFrame();
    }

    function getTotalDuration() {
        return joinerState.timelineClips.reduce((sum, clip) => sum + clip.duration, 0);
    }

    function updateTimelineStats() {
        const total = getTotalDuration();
        const totalBadge = document.getElementById('joiner-total-time-badge');
        const countBadge = document.getElementById('joiner-clips-count-badge');
        const autoDurLabel = document.getElementById('joiner-auto-duration-label');
        const timelineCounter = document.getElementById('joiner-timeline-counter');
        const timeTotal = document.getElementById('joiner-time-total');

        const formatted = formatTime(total);

        if (totalBadge) totalBadge.textContent = `⏱️ Czas: ${total.toFixed(1)}s`;
        if (countBadge) countBadge.textContent = `🎞️ Klipy: ${joinerState.timelineClips.length}`;
        if (autoDurLabel) autoDurLabel.textContent = `${total.toFixed(1)} s`;
        if (timelineCounter) timelineCounter.textContent = `${joinerState.timelineClips.length} klipów`;
        if (timeTotal) timeTotal.textContent = formatted;

        // Jeśli wskaźnik playhead wyszedł poza łączny czas, cofnij go
        if (joinerState.playback.currentTime > total) {
            joinerState.playback.currentTime = total;
            updatePlayheadPosition();
        }
    }

    function renderTimeline() {
        const track = document.getElementById('joiner-clips-track');
        const container = document.getElementById('joiner-timeline-canvas-area');
        if (!track || !container) return;

        track.innerHTML = '';
        const pxPerSec = joinerState.timeline.pxPerSec;
        const totalDuration = getTotalDuration();
        const totalWidth = Math.max(900, Math.round(totalDuration * pxPerSec) + 200);

        container.style.width = `${totalWidth}px`;

        let currentStartTime = 0;

        joinerState.timelineClips.forEach((clip, index) => {
            const clipWidth = Math.max(40, Math.round(clip.duration * pxPerSec));
            const clipLeft = Math.round(currentStartTime * pxPerSec);

            const clipEl = document.createElement('div');
            clipEl.className = 'joiner-timeline-clip' + (joinerState.selectedClipId === clip.id ? ' selected' : '');
            clipEl.style.left = `${clipLeft}px`;
            clipEl.style.width = `${clipWidth}px`;
            clipEl.dataset.clipId = clip.id;

            // Zawartość wizualna klipu
            const contentDiv = document.createElement('div');
            contentDiv.className = 'clip-drag-content';

            if (clip.thumbnail) {
                const thumb = document.createElement('img');
                thumb.className = 'clip-thumb';
                thumb.src = clip.thumbnail;
                thumb.alt = clip.name;
                contentDiv.appendChild(thumb);
            }

            const textInfo = document.createElement('div');
            textInfo.className = 'clip-text-info';

            const nameEl = document.createElement('span');
            nameEl.className = 'clip-name';
            nameEl.textContent = `#${index + 1} ${clip.name}`;

            const durBadge = document.createElement('span');
            durBadge.className = 'clip-dur-badge';
            durBadge.textContent = `${clip.duration.toFixed(1)}s`;
            durBadge.title = 'Kliknij, aby wpisać dokładny czas trwania';

            // Kliknięcie w etykietę czasu umożliwia wpisanie wartości wprost na klipie
            durBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                inlineEditClipDuration(clip, durBadge);
            });

            textInfo.appendChild(nameEl);
            textInfo.appendChild(durBadge);
            contentDiv.appendChild(textInfo);
            clipEl.appendChild(contentDiv);

            // Uchwyt rozciągania czasu po prawej stronie
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'clip-resize-handle';
            resizeHandle.title = 'Przeciągnij w prawo/lewo, aby zmienić czas trwania';
            resizeHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                startResizingClip(clip, e);
            });

            clipEl.appendChild(resizeHandle);

            // Kliknięcie zaznacza klip i otwiera okno inspektora
            clipEl.addEventListener('click', () => {
                selectClip(clip.id);
            });

            track.appendChild(clipEl);
            currentStartTime += clip.duration;
        });

        updatePlayheadPosition();
    }

    function selectClip(clipId) {
        joinerState.selectedClipId = clipId;
        const clip = joinerState.timelineClips.find(c => c.id === clipId);

        // Zaznaczenie wizualne w DOM
        document.querySelectorAll('.joiner-timeline-clip').forEach(el => {
            if (el.dataset.clipId === clipId) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });

        if (clip) {
            showClipInspector(clip);
        } else {
            hideClipInspector();
        }
    }

    function showClipInspector(clip) {
        const inspector = document.getElementById('joiner-clip-inspector');
        const badge = document.getElementById('inspector-clip-badge');
        const name = document.getElementById('inspector-clip-name');
        const typeDims = document.getElementById('inspector-clip-type-dims');
        const durationInput = document.getElementById('inspector-clip-duration');

        if (!inspector) return;

        const clipIndex = joinerState.timelineClips.findIndex(c => c.id === clip.id);
        if (badge) badge.textContent = `#${clipIndex + 1}`;
        if (name) name.textContent = clip.name;
        if (typeDims) {
            const typeStr = clip.type === 'video' ? '🎬 Wideo' : '🖼️ Obraz';
            typeDims.textContent = `${typeStr} (${clip.width}×${clip.height})`;
        }
        if (durationInput) {
            durationInput.value = clip.duration.toFixed(1);
        }

        inspector.style.display = 'block';
    }

    function hideClipInspector() {
        const inspector = document.getElementById('joiner-clip-inspector');
        if (inspector) inspector.style.display = 'none';
    }

    function inlineEditClipDuration(clip, badgeEl) {
        const currentVal = clip.duration;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0.1';
        input.max = '3600';
        input.step = '0.1';
        input.value = currentVal.toFixed(1);
        input.style.width = '60px';
        input.style.fontSize = '0.75rem';
        input.style.padding = '1px 3px';
        input.style.fontFamily = 'var(--font-mono)';
        input.style.borderRadius = '3px';
        input.style.border = '1px solid var(--color-primary)';
        input.style.background = '#000';
        input.style.color = '#fff';

        const applyVal = () => {
            const val = parseFloat(input.value);
            if (!isNaN(val) && val >= 0.1) {
                clip.duration = Math.round(val * 10) / 10;
            }
            renderTimeline();
            renderRuler();
            updateTimelineStats();
            updatePreviewFrame();
            if (joinerState.selectedClipId === clip.id) {
                showClipInspector(clip);
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                applyVal();
            } else if (e.key === 'Escape') {
                renderTimeline();
            }
        });

        input.addEventListener('blur', applyVal);

        badgeEl.parentNode.replaceChild(input, badgeEl);
        input.focus();
        input.select();
    }

    /* =========================================================================
     * 4. PRZECIĄGANIE / ROZCIĄGANIE KLIPU NA TIMELINE (RESIZE)
     * ========================================================================= */
    function startResizingClip(clip, e) {
        joinerState.timeline.resizingClip = clip;
        joinerState.timeline.dragStartX = e.clientX;
        joinerState.timeline.initialDuration = clip.duration;

        const onMouseMove = (moveEvent) => {
            if (!joinerState.timeline.resizingClip) return;
            const deltaX = moveEvent.clientX - joinerState.timeline.dragStartX;
            const deltaDuration = deltaX / joinerState.timeline.pxPerSec;
            const newDuration = Math.max(0.1, joinerState.timeline.initialDuration + deltaDuration);

            clip.duration = Math.round(newDuration * 10) / 10;
            renderTimeline();
            renderRuler();
            updateTimelineStats();

            // Aktualizacja pola w inspektorze jeśli otwarty
            if (joinerState.selectedClipId === clip.id) {
                const durationInput = document.getElementById('inspector-clip-duration');
                if (durationInput) durationInput.value = clip.duration.toFixed(1);
            }
        };

        const onMouseUp = () => {
            joinerState.timeline.resizingClip = null;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            updatePreviewFrame();
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }

    /* =========================================================================
     * 5. LINIJKA (RULER), PLAYHEAD I PRZEWIJANIE (SCROLLING) OSI CZASU
     * ========================================================================= */
    function setupJoinerTimelineEvents() {
        const scroller = document.getElementById('joiner-timeline-scroller');
        const rulerCanvas = document.getElementById('joiner-ruler-canvas');
        const tracksContainer = document.getElementById('joiner-tracks-container');

        // Przewijanie kółkiem myszy w poziomie (Horizontal Scroll)
        if (scroller) {
            scroller.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    scroller.scrollLeft += e.deltaY;
                }
            }, { passive: false });
        }

        // Kliknięcie i przeciąganie po linijce czasu do pozycjonowania playhead
        if (rulerCanvas) {
            rulerCanvas.addEventListener('mousedown', (e) => {
                seekFromTimelineMouseEvent(e);
                joinerState.timeline.isDraggingPlayhead = true;
            });
        }

        if (tracksContainer) {
            tracksContainer.addEventListener('mousedown', (e) => {
                // Jeśli kliknięto w tło ścieżki (nie w klip ani uchwyt)
                if (e.target === tracksContainer || e.target.id === 'joiner-main-track') {
                    seekFromTimelineMouseEvent(e);
                    joinerState.timeline.isDraggingPlayhead = true;
                }
            });
        }

        window.addEventListener('mousemove', (e) => {
            if (joinerState.timeline.isDraggingPlayhead) {
                seekFromTimelineMouseEvent(e);
            }
        });

        window.addEventListener('mouseup', () => {
            joinerState.timeline.isDraggingPlayhead = false;
        });

        // Kontrolki skalowania osi (Zoom)
        const btnZoomIn = document.getElementById('btn-joiner-zoom-in');
        const btnZoomOut = document.getElementById('btn-joiner-zoom-out');
        const btnZoomReset = document.getElementById('btn-joiner-zoom-reset');

        if (btnZoomIn) {
            btnZoomIn.addEventListener('click', () => {
                joinerState.timeline.pxPerSec = Math.min(joinerState.timeline.maxPxPerSec, joinerState.timeline.pxPerSec + 15);
                renderTimeline();
                renderRuler();
            });
        }

        if (btnZoomOut) {
            btnZoomOut.addEventListener('click', () => {
                joinerState.timeline.pxPerSec = Math.max(joinerState.timeline.minPxPerSec, joinerState.timeline.pxPerSec - 15);
                renderTimeline();
                renderRuler();
            });
        }

        if (btnZoomReset) {
            btnZoomReset.addEventListener('click', () => {
                joinerState.timeline.pxPerSec = 60;
                renderTimeline();
                renderRuler();
            });
        }

        // Przycisk wyczyść oś
        const btnClearTimeline = document.getElementById('btn-joiner-clear-timeline');
        if (btnClearTimeline) {
            btnClearTimeline.addEventListener('click', () => {
                if (joinerState.timelineClips.length === 0) return;
                if (confirm('Czy na pewno chcesz usunąć wszystkie klipy z osi czasu?')) {
                    joinerState.timelineClips = [];
                    joinerState.selectedClipId = null;
                    hideClipInspector();
                    renderTimeline();
                    renderRuler();
                    updateTimelineStats();
                    updatePreviewFrame();
                }
            });
        }

        // Obsługa inspektora
        const durationInput = document.getElementById('inspector-clip-duration');
        const btnApplyDuration = document.getElementById('btn-inspector-apply');
        const btnMovePrev = document.getElementById('btn-inspector-move-prev');
        const btnMoveNext = document.getElementById('btn-inspector-move-next');
        const btnRemove = document.getElementById('btn-inspector-remove');

        if (btnApplyDuration && durationInput) {
            const apply = () => {
                if (!joinerState.selectedClipId) return;
                const clip = joinerState.timelineClips.find(c => c.id === joinerState.selectedClipId);
                if (!clip) return;
                const val = parseFloat(durationInput.value);
                if (!isNaN(val) && val >= 0.1) {
                    clip.duration = Math.round(val * 10) / 10;
                    renderTimeline();
                    renderRuler();
                    updateTimelineStats();
                    updatePreviewFrame();
                }
            };
            btnApplyDuration.addEventListener('click', apply);
            durationInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') apply();
            });
        }

        if (btnMovePrev) {
            btnMovePrev.addEventListener('click', () => {
                if (joinerState.selectedClipId) moveClip(joinerState.selectedClipId, -1);
            });
        }

        if (btnMoveNext) {
            btnMoveNext.addEventListener('click', () => {
                if (joinerState.selectedClipId) moveClip(joinerState.selectedClipId, 1);
            });
        }

        if (btnRemove) {
            btnRemove.addEventListener('click', () => {
                if (joinerState.selectedClipId) removeClipFromTimeline(joinerState.selectedClipId);
            });
        }
    }

    function seekFromTimelineMouseEvent(e) {
        const area = document.getElementById('joiner-timeline-canvas-area');
        if (!area) return;

        const rect = area.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const totalDuration = getTotalDuration();
        const pxPerSec = joinerState.timeline.pxPerSec;

        const targetTime = Math.max(0, Math.min(totalDuration, offsetX / pxPerSec));
        joinerState.playback.currentTime = targetTime;
        updatePlayheadPosition();
        updatePreviewFrame();
    }

    function updatePlayheadPosition() {
        const playhead = document.getElementById('joiner-playhead');
        const timeCurrent = document.getElementById('joiner-time-current');
        if (!playhead) return;

        const pxPerSec = joinerState.timeline.pxPerSec;
        const posX = Math.round(joinerState.playback.currentTime * pxPerSec);
        playhead.style.left = `${posX}px`;

        if (timeCurrent) {
            timeCurrent.textContent = formatTime(joinerState.playback.currentTime);
        }

        // Autoscroll: jeśli odtwarzamy i playhead wybiega poza pole widzenia
        const scroller = document.getElementById('joiner-timeline-scroller');
        if (scroller && joinerState.playback.isPlaying) {
            const scrollerLeft = scroller.scrollLeft;
            const scrollerWidth = scroller.clientWidth;
            if (posX > scrollerLeft + scrollerWidth - 50) {
                scroller.scrollLeft = posX - scrollerWidth / 2;
            } else if (posX < scrollerLeft) {
                scroller.scrollLeft = Math.max(0, posX - 50);
            }
        }
    }

    function renderRuler() {
        const canvas = document.getElementById('joiner-ruler-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const totalDuration = getTotalDuration();
        const pxPerSec = joinerState.timeline.pxPerSec;
        const totalWidth = Math.max(900, Math.round(totalDuration * pxPerSec) + 200);

        canvas.width = totalWidth;
        canvas.height = 26;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';

        const step = pxPerSec >= 80 ? 0.5 : (pxPerSec >= 30 ? 1 : 2);
        const maxSec = Math.ceil(totalWidth / pxPerSec);

        for (let sec = 0; sec <= maxSec; sec += step) {
            const x = Math.round(sec * pxPerSec);
            const isMajor = Math.floor(sec) === sec;

            ctx.beginPath();
            ctx.moveTo(x, isMajor ? 10 : 18);
            ctx.lineTo(x, 26);
            ctx.stroke();

            if (isMajor) {
                ctx.fillText(`${sec}s`, x + 3, 11);
            }
        }
    }

    /* =========================================================================
     * 6. ODTWARZACZ PODGLĄDU NA ŻYWO (LIVE SEQUENCE PLAYER)
     * ========================================================================= */
    function setupJoinerControls() {
        const btnPlay = document.getElementById('btn-joiner-play');
        const btnStop = document.getElementById('btn-joiner-stop');
        const btnRewind = document.getElementById('btn-joiner-rewind');

        if (btnPlay) {
            btnPlay.addEventListener('click', togglePlayback);
        }

        if (btnStop) {
            btnStop.addEventListener('click', () => {
                pausePlayback();
                joinerState.playback.currentTime = 0;
                updatePlayheadPosition();
                updatePreviewFrame();
            });
        }

        if (btnRewind) {
            btnRewind.addEventListener('click', () => {
                joinerState.playback.currentTime = 0;
                updatePlayheadPosition();
                updatePreviewFrame();
            });
        }
    }

    function togglePlayback() {
        if (joinerState.playback.isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    }

    function startPlayback() {
        const total = getTotalDuration();
        if (total <= 0) return;

        if (joinerState.playback.currentTime >= total) {
            joinerState.playback.currentTime = 0;
        }

        joinerState.playback.isPlaying = true;
        joinerState.playback.lastTimestamp = performance.now();

        const btnPlay = document.getElementById('btn-joiner-play');
        if (btnPlay) btnPlay.textContent = '⏸️';

        const loop = (timestamp) => {
            if (!joinerState.playback.isPlaying) return;

            const delta = (timestamp - joinerState.playback.lastTimestamp) / 1000;
            joinerState.playback.lastTimestamp = timestamp;

            joinerState.playback.currentTime += delta;
            if (joinerState.playback.currentTime >= total) {
                joinerState.playback.currentTime = 0; // Zapętlenie odtwarzania
            }

            updatePlayheadPosition();
            updatePreviewFrame();

            joinerState.playback.animId = requestAnimationFrame(loop);
        };

        joinerState.playback.animId = requestAnimationFrame(loop);
    }

    function pausePlayback() {
        joinerState.playback.isPlaying = false;
        if (joinerState.playback.animId) {
            cancelAnimationFrame(joinerState.playback.animId);
            joinerState.playback.animId = null;
        }
        const btnPlay = document.getElementById('btn-joiner-play');
        if (btnPlay) btnPlay.textContent = '▶️';
    }

    function getActiveClipAtTime(targetTime) {
        let accTime = 0;
        for (let i = 0; i < joinerState.timelineClips.length; i++) {
            const clip = joinerState.timelineClips[i];
            const startTime = accTime;
            const endTime = accTime + clip.duration;
            if (targetTime >= startTime && targetTime < endTime) {
                return {
                    clip,
                    index: i,
                    localTime: targetTime - startTime,
                    startTime,
                    endTime
                };
            }
            accTime = endTime;
        }

        // Jeśli czas równy łącznemu czasowi, zwróć ostatni klip
        if (joinerState.timelineClips.length > 0 && targetTime >= accTime) {
            const lastClip = joinerState.timelineClips[joinerState.timelineClips.length - 1];
            return {
                clip: lastClip,
                index: joinerState.timelineClips.length - 1,
                localTime: lastClip.duration,
                startTime: accTime - lastClip.duration,
                endTime: accTime
            };
        }

        return null;
    }

    function updatePreviewFrame() {
        const canvas = document.getElementById('joiner-preview-canvas');
        const placeholder = document.getElementById('joiner-preview-placeholder');
        const activeClipLabel = document.getElementById('joiner-active-clip-label');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        if (joinerState.timelineClips.length === 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (placeholder) placeholder.style.display = 'flex';
            if (activeClipLabel) activeClipLabel.textContent = 'Brak klipów';
            return;
        }

        if (placeholder) placeholder.style.display = 'none';

        const active = getActiveClipAtTime(joinerState.playback.currentTime);
        if (!active) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (activeClipLabel) activeClipLabel.textContent = 'Poza zakresem';
            return;
        }

        const clip = active.clip;
        if (activeClipLabel) {
            activeClipLabel.textContent = `Klip ${active.index + 1}/${joinerState.timelineClips.length}: ${clip.name}`;
        }

        const fitModeSelect = document.getElementById('joiner-fit-mode');
        const fitMode = fitModeSelect ? fitModeSelect.value : 'letterbox';

        // Renderowanie klatki
        if (clip.type === 'image') {
            const img = new Image();
            img.src = clip.url;
            if (img.complete && img.naturalWidth > 0) {
                drawMediaToCanvas(ctx, img, img.naturalWidth, img.naturalHeight, canvas.width, canvas.height, fitMode);
            } else {
                img.onload = () => {
                    drawMediaToCanvas(ctx, img, img.naturalWidth, img.naturalHeight, canvas.width, canvas.height, fitMode);
                };
            }
        } else if (clip.type === 'video') {
            let vid = joinerState.videoElementsCache.get(clip.url);
            if (!vid) {
                vid = document.createElement('video');
                vid.src = clip.url;
                vid.muted = true;
                vid.playsInline = true;
                vid.crossOrigin = 'anonymous';
                joinerState.videoElementsCache.set(clip.url, vid);
            }

            const targetVideoTime = clip.naturalDuration > 0 ? (active.localTime % clip.naturalDuration) : 0;
            if (Math.abs(vid.currentTime - targetVideoTime) > 0.1) {
                vid.currentTime = targetVideoTime;
            }

            drawMediaToCanvas(ctx, vid, vid.videoWidth || clip.width, vid.videoHeight || clip.height, canvas.width, canvas.height, fitMode);
        }
    }

    function drawMediaToCanvas(ctx, media, srcW, srcH, dstW, dstH, fitMode) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, dstW, dstH);

        if (!srcW || !srcH) return;

        if (fitMode === 'stretch') {
            ctx.drawImage(media, 0, 0, dstW, dstH);
            return;
        }

        const srcAspect = srcW / srcH;
        const dstAspect = dstW / dstH;

        let drawW, drawH, drawX, drawY;

        if (fitMode === 'cover') {
            if (srcAspect > dstAspect) {
                drawH = dstH;
                drawW = dstH * srcAspect;
                drawX = (dstW - drawW) / 2;
                drawY = 0;
            } else {
                drawW = dstW;
                drawH = dstW / srcAspect;
                drawX = 0;
                drawY = (dstH - drawH) / 2;
            }
        } else {
            // Letterbox (Dopasuj proporcje - domyślne)
            if (srcAspect > dstAspect) {
                drawW = dstW;
                drawH = dstW / srcAspect;
                drawX = 0;
                drawY = (dstH - drawH) / 2;
            } else {
                drawH = dstH;
                drawW = dstH * srcAspect;
                drawX = (dstW - drawW) / 2;
                drawY = 0;
            }
        }

        ctx.drawImage(media, Math.round(drawX), Math.round(drawY), Math.round(drawW), Math.round(drawH));
    }

    /* =========================================================================
     * 7. USTAWIENIA EKSPORTU I SILNIK RENDEROWANIA DO MP4
     * ========================================================================= */
    function setupJoinerExport() {
        const btnExportSidebar = document.getElementById('btn-joiner-export-sidebar');
        const btnExportTop = document.getElementById('btn-joiner-export-top');
        const resSelect = document.getElementById('joiner-export-resolution');
        const customResRow = document.getElementById('joiner-custom-res-row');
        const durAutoRadio = document.getElementById('joiner-dur-auto');
        const durCustomRadio = document.getElementById('joiner-dur-custom');
        const customDurInput = document.getElementById('joiner-custom-duration-input');

        if (resSelect && customResRow) {
            resSelect.addEventListener('change', () => {
                if (resSelect.value === 'custom') {
                    customResRow.style.display = 'flex';
                } else {
                    customResRow.style.display = 'none';
                }
            });
        }

        if (durAutoRadio && durCustomRadio && customDurInput) {
            durAutoRadio.addEventListener('change', () => {
                customDurInput.disabled = true;
            });
            durCustomRadio.addEventListener('change', () => {
                customDurInput.disabled = false;
                customDurInput.focus();
            });
        }

        if (btnExportSidebar) {
            btnExportSidebar.addEventListener('click', startSequenceExport);
        }

        if (btnExportTop) {
            btnExportTop.addEventListener('click', startSequenceExport);
        }

        // Obsługa modala eksportu
        const btnCancel = document.getElementById('btn-joiner-cancel-render');
        const btnClose = document.getElementById('btn-joiner-close-modal');
        const btnDownloadAgain = document.getElementById('btn-joiner-download-result');

        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                joinerState.export.cancelRequested = true;
                if (joinerState.export.recorder && joinerState.export.recorder.state !== 'inactive') {
                    joinerState.export.recorder.stop();
                }
                hideExportModal();
            });
        }

        if (btnClose) {
            btnClose.addEventListener('click', hideExportModal);
        }

        if (btnDownloadAgain) {
            btnDownloadAgain.addEventListener('click', () => {
                if (joinerState.export.resultBlob) {
                    const filenameInput = document.getElementById('joiner-output-name');
                    const filename = (filenameInput ? filenameInput.value.trim() : '') || 'zlaczony_film.mp4';
                    downloadBlob(joinerState.export.resultBlob, filename);
                }
            });
        }
    }

    function getExportDimensions() {
        const resSelect = document.getElementById('joiner-export-resolution');
        const val = resSelect ? resSelect.value : 'fhd';

        switch (val) {
            case 'original': {
                let maxW = 0;
                let maxH = 0;
                joinerState.files.forEach(f => {
                    if (f.width > maxW) maxW = f.width;
                    if (f.height > maxH) maxH = f.height;
                });
                return {
                    width: maxW || 1920,
                    height: maxH || 1080
                };
            }
            case '4k':
                return { width: 3840, height: 2160 };
            case 'fhd':
                return { width: 1920, height: 1080 };
            case 'hd':
                return { width: 1280, height: 720 };
            case 'a4-v':
                // 210 x 297 mm w 300 DPI
                return { width: 2480, height: 3508 };
            case 'a4-h':
                // 297 x 210 mm w 300 DPI
                return { width: 3508, height: 2480 };
            case 'a4-v-screen':
                // 210 x 297 mm w 150 DPI
                return { width: 1240, height: 1754 };
            case 'a4-h-screen':
                // 297 x 210 mm w 150 DPI
                return { width: 1754, height: 1240 };
            case 'custom': {
                const wInput = document.getElementById('joiner-custom-width');
                const hInput = document.getElementById('joiner-custom-height');
                const w = wInput ? parseInt(wInput.value) : 1920;
                const h = hInput ? parseInt(hInput.value) : 1080;
                return {
                    width: Math.max(100, Math.min(7680, w || 1920)),
                    height: Math.max(100, Math.min(7680, h || 1080))
                };
            }
            default:
                return { width: 1920, height: 1080 };
        }
    }

    async function startSequenceExport() {
        if (joinerState.timelineClips.length === 0) {
            alert('Dodaj najpierw zdjęcia lub wideo na oś czasu (timeline)!');
            return;
        }

        if (joinerState.export.isExporting) return;

        // Zatrzymaj podgląd
        pausePlayback();

        // Oblicz czas trwania
        const durCustomRadio = document.getElementById('joiner-dur-custom');
        const customDurInput = document.getElementById('joiner-custom-duration-input');
        let totalDuration = getTotalDuration();

        if (durCustomRadio && durCustomRadio.checked && customDurInput) {
            const customVal = parseFloat(customDurInput.value);
            if (!isNaN(customVal) && customVal > 0) {
                totalDuration = customVal;
            }
        }

        if (totalDuration <= 0) {
            alert('Czas trwania filmu musi być większy od zera.');
            return;
        }

        const dims = getExportDimensions();
        const fpsSelect = document.getElementById('joiner-fps-select');
        const fps = fpsSelect ? parseInt(fpsSelect.value) : 30;
        const totalFrames = Math.max(1, Math.round(totalDuration * fps));

        const fitModeSelect = document.getElementById('joiner-fit-mode');
        const fitMode = fitModeSelect ? fitModeSelect.value : 'letterbox';

        const filenameInput = document.getElementById('joiner-output-name');
        let targetFilename = (filenameInput ? filenameInput.value.trim() : '') || 'zlaczony_film.mp4';
        if (!/\.(mp4|webm)$/i.test(targetFilename)) {
            targetFilename += '.mp4';
        }

        // Pokaż modal postępu
        showExportModal(totalFrames);
        joinerState.export.isExporting = true;
        joinerState.export.cancelRequested = false;

        // Tworzenie canvasu renderującego
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = dims.width;
        exportCanvas.height = dims.height;
        const ctx = exportCanvas.getContext('2d', { alpha: false, desynchronized: true });

        // Ustalenie MIME Type (preferowany MP4/H.264 z fallbackiem WebM)
        let mimeType = 'video/mp4;codecs=avc1.42E01E';
        if (typeof window.getPreferredMimeType === 'function') {
            mimeType = window.getPreferredMimeType('mp4');
        } else {
            const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
            for (const t of types) {
                if (MediaRecorder.isTypeSupported(t)) {
                    mimeType = t;
                    break;
                }
            }
        }

        const stream = exportCanvas.captureStream(fps);
        const streamTrack = stream.getVideoTracks()[0];
        let recorder;
        const chunks = [];

        try {
            recorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: dims.width >= 3840 ? 18000000 : 8500000
            });
            joinerState.export.recorder = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) chunks.push(e.data);
            };

            recorder.onerror = (e) => {
                console.error('Błąd MediaRecorder podczas łączenia:', e);
            };
        } catch (e) {
            alert('Błąd inicjalizacji nagrywania wideo: ' + e.message);
            hideExportModal();
            joinerState.export.isExporting = false;
            return;
        }

        recorder.start(250);

        // Preload obrazów do pamięci podręcznej dla maksymalnej szybkości
        const imageElements = new Map();
        for (const clip of joinerState.timelineClips) {
            if (clip.type === 'image' && !imageElements.has(clip.url)) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = clip.url;
                await new Promise(r => {
                    if (img.complete) r();
                    else img.onload = img.onerror = r;
                });
                imageElements.set(clip.url, img);
            }
        }

        // Pętla renderowania klatek
        const startTime = performance.now();
        let lastReportTime = startTime;

        for (let frame = 0; frame < totalFrames; frame++) {
            if (joinerState.export.cancelRequested) {
                break;
            }

            const currentTime = frame / fps;
            const active = getActiveClipAtTime(currentTime);

            if (active) {
                const clip = active.clip;
                if (clip.type === 'image') {
                    const img = imageElements.get(clip.url);
                    if (img) {
                        drawMediaToCanvas(ctx, img, img.naturalWidth, img.naturalHeight, dims.width, dims.height, fitMode);
                    }
                } else if (clip.type === 'video') {
                    const vid = joinerState.videoElementsCache.get(clip.url);
                    if (vid) {
                        const targetVidTime = clip.naturalDuration > 0 ? (active.localTime % clip.naturalDuration) : 0;
                        if (Math.abs(vid.currentTime - targetVidTime) > 0.04) {
                            await seekVideoPrecise(vid, targetVidTime);
                        }
                        drawMediaToCanvas(ctx, vid, vid.videoWidth || clip.width, vid.videoHeight || clip.height, dims.width, dims.height, fitMode);
                    }
                }
            } else {
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, dims.width, dims.height);
            }

            // Wymuszenie nowej klatki w strumieniu Canvas
            if (streamTrack && typeof streamTrack.requestFrame === 'function') {
                streamTrack.requestFrame();
            }

            // Aktualizacja wskaźnika postępu co kilka klatek
            const now = performance.now();
            if (now - lastReportTime > 80 || frame === totalFrames - 1) {
                lastReportTime = now;
                const percent = Math.round(((frame + 1) / totalFrames) * 100);
                const elapsedSec = (now - startTime) / 1000;
                const speedFps = (frame + 1) / (elapsedSec || 0.001);

                updateExportModalProgress(frame + 1, totalFrames, percent, speedFps.toFixed(1));
                // Oddanie kontroli przeglądarce, aby odświeżyła UI
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (joinerState.export.cancelRequested) {
            joinerState.export.isExporting = false;
            return;
        }

        // Kończenie nagrywania
        updateExportModalStatus('Finalizowanie pliku MP4...');
        await new Promise(r => setTimeout(r, 300));

        recorder.onstop = async () => {
            let finalBlob = new Blob(chunks, { type: mimeType });

            // Jeśli to WebM, napraw czas trwania
            if (mimeType.includes('webm') && typeof window.fixWebmDuration === 'function' && finalBlob.size > 40) {
                try {
                    finalBlob = await window.fixWebmDuration(finalBlob, totalDuration * 1000);
                } catch (e) {
                    console.warn('fixWebmDuration failed:', e);
                }
            }

            joinerState.export.resultBlob = finalBlob;
            joinerState.export.isExporting = false;

            // Automatyczne pobranie
            downloadBlob(finalBlob, targetFilename);

            // Pokazanie sukcesu i odtwarzacza w modalu
            showExportSuccess(finalBlob);
        };

        recorder.stop();
    }

    function seekVideoPrecise(video, targetTime) {
        return new Promise((resolve) => {
            if (!isFinite(targetTime) || targetTime < 0) {
                resolve();
                return;
            }

            let timeoutId;
            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                clearTimeout(timeoutId);
                resolve();
            };

            video.addEventListener('seeked', onSeeked, { once: true });
            timeoutId = setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                resolve();
            }, 100);

            try {
                video.currentTime = targetTime;
            } catch (e) {
                clearTimeout(timeoutId);
                resolve();
            }
        });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);
    }

    function showExportModal(totalFrames) {
        const modal = document.getElementById('joiner-export-modal');
        const progressBar = document.getElementById('joiner-export-progress-fill');
        const percentEl = document.getElementById('joiner-export-percent');
        const detailEl = document.getElementById('joiner-export-detail');
        const titleEl = document.getElementById('joiner-export-title');
        const successBox = document.getElementById('joiner-export-success-box');
        const btnCancel = document.getElementById('btn-joiner-cancel-render');
        const btnClose = document.getElementById('btn-joiner-close-modal');
        const btnDownloadAgain = document.getElementById('btn-joiner-download-result');

        if (!modal) return;

        if (progressBar) progressBar.style.width = '0%';
        if (percentEl) percentEl.textContent = '0%';
        if (detailEl) detailEl.textContent = `Klatka 0 / ${totalFrames}`;
        if (titleEl) titleEl.textContent = 'Renderowanie sekwencji wideo...';
        if (successBox) successBox.style.display = 'none';

        if (btnCancel) btnCancel.style.display = 'inline-block';
        if (btnClose) btnClose.style.display = 'none';
        if (btnDownloadAgain) btnDownloadAgain.style.display = 'none';

        modal.style.display = 'flex';
    }

    function updateExportModalProgress(currentFrame, totalFrames, percent, speed) {
        const progressBar = document.getElementById('joiner-export-progress-fill');
        const percentEl = document.getElementById('joiner-export-percent');
        const detailEl = document.getElementById('joiner-export-detail');
        const speedEl = document.getElementById('joiner-export-speed');

        if (progressBar) progressBar.style.width = `${percent}%`;
        if (percentEl) percentEl.textContent = `${percent}%`;
        if (detailEl) detailEl.textContent = `Klatka ${currentFrame} / ${totalFrames}`;
        if (speedEl) speedEl.textContent = `Szybkość: ${speed} fps`;
    }

    function updateExportModalStatus(text) {
        const titleEl = document.getElementById('joiner-export-title');
        if (titleEl) titleEl.textContent = text;
    }

    function showExportSuccess(blob) {
        const successBox = document.getElementById('joiner-export-success-box');
        const videoPlayer = document.getElementById('joiner-export-video-player');
        const titleEl = document.getElementById('joiner-export-title');
        const btnCancel = document.getElementById('btn-joiner-cancel-render');
        const btnClose = document.getElementById('btn-joiner-close-modal');
        const btnDownloadAgain = document.getElementById('btn-joiner-download-result');

        if (titleEl) titleEl.textContent = '✓ Eksport zakończony sukcesem!';
        if (btnCancel) btnCancel.style.display = 'none';
        if (btnClose) btnClose.style.display = 'inline-block';
        if (btnDownloadAgain) btnDownloadAgain.style.display = 'inline-block';

        if (successBox && videoPlayer) {
            successBox.style.display = 'block';
            videoPlayer.src = URL.createObjectURL(blob);
            videoPlayer.play().catch(() => {});
        }
    }

    function hideExportModal() {
        const modal = document.getElementById('joiner-export-modal');
        const videoPlayer = document.getElementById('joiner-export-video-player');
        if (videoPlayer) {
            videoPlayer.pause();
            videoPlayer.src = '';
        }
        if (modal) modal.style.display = 'none';
    }

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '00:00.0';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const tenths = Math.floor((seconds % 1) * 10);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
    }

    window.joinerState = joinerState;
    window.openJoinerView = openJoinerView;
    window.closeJoinerView = closeJoinerView;
})();

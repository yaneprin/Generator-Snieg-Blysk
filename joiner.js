/**
 * Snow Sparkle Generator - Prosty i Przyjazny Moduł Łączenia Wideo i Zdjęć w jedno MP4
 * Umożliwia proste wgrywanie plików (zdjęcia, grafiki 2D, wideo),
 * układanie ich w sekwencji poprzez przeciąganie lub strzałki ◀ / ▶,
 * wpisywanie czasu trwania dla zdjęć oraz wyświetlanie długości dla wideo,
 * z szybkim podglądem i eksportem do pliku MP4.
 */

(function () {
    'use strict';

    // Stan modułu łączenia
    const joinerState = {
        items: [], // { id, name, type: 'image'|'video', file, url, width, height, duration, thumbnail }
        playback: {
            currentTime: 0,
            isPlaying: false,
            animId: null,
            lastTimestamp: 0
        },
        export: {
            isExporting: false,
            cancelRequested: false,
            recorder: null,
            resultBlob: null
        },
        draggedIndex: null,
        videoElementsCache: new Map() // url -> HTMLVideoElement
    };

    // Inicjalizacja po załadowaniu DOM
    document.addEventListener('DOMContentLoaded', () => {
        setupJoinerViewToggle();
        setupJoinerUpload();
        setupJoinerControls();
        setupJoinerExport();
        renderSequenceCards();
        updateSequenceStats();
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

        // Obsługa spacji do odtwarzania w widoku łączenia
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
                renderSequenceCards();
                updateSequenceStats();
                updatePreviewFrame();
            }, 40);
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
        const fileInput = document.getElementById('joiner-file-input');
        const btnAddMore = document.getElementById('btn-add-more-files');
        const btnClearAll = document.getElementById('btn-joiner-clear-all');
        const board = document.querySelector('.joiner-sequence-board');

        if (btnAddMore && fileInput) {
            btnAddMore.addEventListener('click', () => fileInput.click());
        }

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    const files = Array.from(e.target.files);
                    fileInput.value = '';
                    handleUploadedFiles(files);
                }
            });
        }

        // Obsługa upuszczania plików bezpośrednio na tablicę sekwencji
        if (board && fileInput) {
            board.addEventListener('dragover', (e) => {
                e.preventDefault();
                board.classList.add('dragover');
            });
            board.addEventListener('dragleave', (e) => {
                if (e.target === board) board.classList.remove('dragover');
            });
            board.addEventListener('drop', (e) => {
                e.preventDefault();
                board.classList.remove('dragover');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const files = Array.from(e.dataTransfer.files);
                    handleUploadedFiles(files);
                }
            });
        }

        if (btnClearAll) {
            btnClearAll.addEventListener('click', () => {
                if (joinerState.items.length === 0) return;
                if (confirm('Czy na pewno chcesz usunąć wszystkie pliki z sekwencji?')) {
                    pausePlayback();
                    joinerState.items = [];
                    joinerState.playback.currentTime = 0;
                    renderSequenceCards();
                    updateSequenceStats();
                    updateOriginalResolutionOption();
                    updatePreviewFrame();
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
            const itemId = 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

            if (isImage) {
                try {
                    const imgMeta = await loadImageMetadata(fileUrl);
                    joinerState.items.push({
                        id: itemId,
                        name: file.name,
                        type: 'image',
                        file: file,
                        url: fileUrl,
                        width: imgMeta.width,
                        height: imgMeta.height,
                        duration: 3.0, // Domyślny czas wyświetlania zdjęcia: 3.0 sekundy
                        thumbnail: imgMeta.thumbnail
                    });
                } catch (err) {
                    console.error('Błąd wczytywania zdjęcia:', err);
                }
            } else if (isVideo) {
                try {
                    const vidMeta = await loadVideoMetadata(fileUrl);
                    joinerState.items.push({
                        id: itemId,
                        name: file.name,
                        type: 'video',
                        file: file,
                        url: fileUrl,
                        width: vidMeta.width,
                        height: vidMeta.height,
                        duration: vidMeta.duration, // Dokładny czas trwania wideo
                        thumbnail: vidMeta.thumbnail
                    });
                } catch (err) {
                    console.error('Błąd wczytywania wideo:', err);
                }
            }
        }

        renderSequenceCards();
        updateSequenceStats();
        updateOriginalResolutionOption();
        updatePreviewFrame();
    }

    function loadImageMetadata(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const w = img.naturalWidth || 1920;
                const h = img.naturalHeight || 1080;
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = 160;
                thumbCanvas.height = Math.round(160 * (h / w));
                const ctx = thumbCanvas.getContext('2d');
                ctx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
                const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.75);
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
            vid.preload = 'metadata';

            vid.onloadedmetadata = () => {
                const duration = (isFinite(vid.duration) && vid.duration > 0) ? vid.duration : 5.0;
                vid.currentTime = Math.min(0.5, duration / 2);
            };

            vid.onseeked = () => {
                const w = vid.videoWidth || 1920;
                const h = vid.videoHeight || 1080;
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = 160;
                thumbCanvas.height = Math.round(160 * (h / w));
                const ctx = thumbCanvas.getContext('2d');
                ctx.drawImage(vid, 0, 0, thumbCanvas.width, thumbCanvas.height);
                const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.75);

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

    /* =========================================================================
     * 3. RENDEROWANIE KAFELKÓW (KART) I ZAMIANA KOLEJNOŚCI
     * ========================================================================= */
    function renderSequenceCards() {
        const container = document.getElementById('joiner-cards-container');
        if (!container) return;

        container.innerHTML = '';

        if (joinerState.items.length === 0) {
            // Pusty stan początkowy (Dropzone z przyciskiem)
            const emptyZone = document.createElement('div');
            emptyZone.className = 'joiner-empty-dropzone';
            emptyZone.id = 'joiner-empty-zone';
            emptyZone.innerHTML = `
                <span class="empty-icon">📤</span>
                <h4>Przeciągnij tutaj zdjęcia, grafiki 2D i filmy</h4>
                <p>lub kliknij poniższy przycisk, aby wybrać pliki z komputera</p>
                <button type="button" id="btn-browse-empty" class="btn btn-primary btn-glow" style="margin-top: 10px;">
                    📁 Wybierz pliki (Zdjęcia & Wideo)
                </button>
                <p class="empty-subtext">Możesz zaznaczyć wiele plików naraz (JPG, PNG, WEBP, GIF, SVG, MP4, WebM)</p>
            `;

            emptyZone.addEventListener('click', (e) => {
                const fileInput = document.getElementById('joiner-file-input');
                if (fileInput) fileInput.click();
            });

            container.appendChild(emptyZone);
            return;
        }

        // Renderowanie kafelków plików
        joinerState.items.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'joiner-file-card';
            card.setAttribute('draggable', 'true');
            card.dataset.index = index;
            card.dataset.id = item.id;

            // Górny pasek: Numer, Typ, Usuń
            const topBar = document.createElement('div');
            topBar.className = 'card-top-bar';

            const orderBadge = document.createElement('span');
            orderBadge.className = 'card-order-badge';
            orderBadge.textContent = `#${index + 1}`;

            const typeBadge = document.createElement('span');
            typeBadge.className = 'card-type-badge';
            typeBadge.textContent = item.type === 'video' ? '🎬 Wideo' : '🖼️ Zdjęcie';

            const btnDelete = document.createElement('button');
            btnDelete.className = 'card-btn-delete';
            btnDelete.title = 'Usuń ten plik z filmu';
            btnDelete.innerHTML = '&times;';
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                removeItemFromSequence(item.id);
            });

            topBar.appendChild(orderBadge);
            topBar.appendChild(typeBadge);
            topBar.appendChild(btnDelete);
            card.appendChild(topBar);

            // Miniatura
            const thumbContainer = document.createElement('div');
            thumbContainer.className = 'card-thumb-container';
            const thumbImg = document.createElement('img');
            thumbImg.className = 'card-thumb-img';
            thumbImg.src = item.thumbnail || '';
            thumbImg.alt = item.name;
            thumbContainer.appendChild(thumbImg);
            card.appendChild(thumbContainer);

            // Metadane: Nazwa i wymiary
            const metaDiv = document.createElement('div');
            metaDiv.className = 'card-meta';

            const filenameEl = document.createElement('span');
            filenameEl.className = 'card-filename';
            filenameEl.textContent = item.name;
            filenameEl.title = item.name;

            const dimsEl = document.createElement('span');
            dimsEl.className = 'card-dims';
            dimsEl.textContent = `${item.width} × ${item.height} px`;

            metaDiv.appendChild(filenameEl);
            metaDiv.appendChild(dimsEl);
            card.appendChild(metaDiv);

            // Okienko czasu trwania (zgodnie z życzeniem użytkownika: wpisywane dla zdjęć, tylko wyświetlane dla wideo)
            const durBox = document.createElement('div');
            durBox.className = 'card-duration-box';

            const durLabel = document.createElement('label');
            durLabel.innerHTML = '⏱️ Czas trwania:';
            durBox.appendChild(durLabel);

            if (item.type === 'image') {
                const inputWrapper = document.createElement('div');
                inputWrapper.className = 'duration-input-wrapper';

                const durInput = document.createElement('input');
                durInput.type = 'number';
                durInput.className = 'card-duration-input';
                durInput.min = '0.1';
                durInput.max = '3600';
                durInput.step = '0.5';
                durInput.value = item.duration.toFixed(1);
                durInput.title = 'Wpisz jak długo ma trwać to zdjęcie w filmie (w sekundach)';

                const updateDuration = () => {
                    const val = parseFloat(durInput.value);
                    if (!isNaN(val) && val >= 0.1) {
                        item.duration = Math.round(val * 10) / 10;
                    } else {
                        item.duration = 1.0;
                        durInput.value = '1.0';
                    }
                    updateSequenceStats();
                    updatePreviewFrame();
                };

                durInput.addEventListener('change', updateDuration);
                durInput.addEventListener('input', updateDuration);

                // Zablokuj przeciąganie kafelka podczas pisania w inpucie
                durInput.addEventListener('mousedown', (e) => e.stopPropagation());

                const secSpan = document.createElement('span');
                secSpan.textContent = 'sekund';
                secSpan.style.fontSize = '0.78rem';
                secSpan.style.color = 'var(--color-text-muted)';

                inputWrapper.appendChild(durInput);
                inputWrapper.appendChild(secSpan);
                durBox.appendChild(inputWrapper);
            } else {
                // Dla wideo tylko ukazuje ile trwa
                const staticDur = document.createElement('div');
                staticDur.className = 'duration-video-tag';
                staticDur.innerHTML = `<strong>${formatTime(item.duration)}</strong> <span style="font-size:0.75rem; color:var(--color-text-muted);">(${item.duration.toFixed(1)}s)</span>`;
                durBox.appendChild(staticDur);
            }

            card.appendChild(durBox);

            // Dolne przyciski przesuwania: ◀ W lewo / W prawo ▶
            const actionsRow = document.createElement('div');
            actionsRow.className = 'card-bottom-actions';

            const btnLeft = document.createElement('button');
            btnLeft.className = 'btn btn-secondary btn-xs card-btn-move-left';
            btnLeft.innerHTML = '◀ W lewo';
            btnLeft.title = 'Przesuń ten plik wcześniej w filmie';
            if (index === 0) btnLeft.disabled = true;
            btnLeft.addEventListener('click', (e) => {
                e.stopPropagation();
                moveItem(index, -1);
            });

            const dragHint = document.createElement('span');
            dragHint.className = 'drag-hint';
            dragHint.textContent = '⋮⋮ Przeciągnij';
            dragHint.title = 'Chwyć i przeciągnij ten kafelek, aby zmienić kolejność';

            const btnRight = document.createElement('button');
            btnRight.className = 'btn btn-secondary btn-xs card-btn-move-right';
            btnRight.innerHTML = 'W prawo ▶';
            btnRight.title = 'Przesuń ten plik później w filmie';
            if (index === joinerState.items.length - 1) btnRight.disabled = true;
            btnRight.addEventListener('click', (e) => {
                e.stopPropagation();
                moveItem(index, 1);
            });

            actionsRow.appendChild(btnLeft);
            actionsRow.appendChild(dragHint);
            actionsRow.appendChild(btnRight);
            card.appendChild(actionsRow);

            // Obsługa Drag & Drop kafelków
            setupCardDragAndDrop(card, index);

            container.appendChild(card);
        });
    }

    function setupCardDragAndDrop(card, index) {
        card.addEventListener('dragstart', (e) => {
            joinerState.draggedIndex = index;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.querySelectorAll('.joiner-file-card').forEach(c => c.classList.remove('drag-over'));
            joinerState.draggedIndex = null;
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (joinerState.draggedIndex !== null && joinerState.draggedIndex !== index) {
                card.classList.add('drag-over');
            }
        });

        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over');
        });

        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');
            const fromIndex = joinerState.draggedIndex;
            const toIndex = index;

            if (fromIndex !== null && fromIndex !== toIndex) {
                const movedItem = joinerState.items.splice(fromIndex, 1)[0];
                joinerState.items.splice(toIndex, 0, movedItem);
                renderSequenceCards();
                updateSequenceStats();
                updatePreviewFrame();
            }
        });
    }

    function moveItem(index, direction) {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= joinerState.items.length) return;

        const temp = joinerState.items[index];
        joinerState.items[index] = joinerState.items[targetIndex];
        joinerState.items[targetIndex] = temp;

        renderSequenceCards();
        updateSequenceStats();
        updatePreviewFrame();
    }

    function removeItemFromSequence(itemId) {
        joinerState.items = joinerState.items.filter(i => i.id !== itemId);
        renderSequenceCards();
        updateSequenceStats();
        updateOriginalResolutionOption();
        updatePreviewFrame();
    }

    function getTotalDuration() {
        return joinerState.items.reduce((sum, item) => sum + item.duration, 0);
    }

    function updateSequenceStats() {
        const total = getTotalDuration();
        const count = joinerState.items.length;

        const totalBadge = document.getElementById('joiner-total-time-badge');
        const countBadge = document.getElementById('joiner-clips-count-badge');
        const summaryTime = document.getElementById('joiner-export-summary-time');
        const timeTotal = document.getElementById('joiner-time-total');
        const scrubber = document.getElementById('joiner-player-scrubber');

        if (totalBadge) totalBadge.textContent = `⏱️ Łączny czas: ${total.toFixed(1)}s`;
        if (countBadge) countBadge.textContent = `🎞️ Pliki: ${count}`;
        if (summaryTime) summaryTime.textContent = `${total.toFixed(1)} s`;
        if (timeTotal) timeTotal.textContent = formatTime(total);

        if (scrubber) {
            scrubber.max = total > 0 ? total : 100;
            if (joinerState.playback.currentTime > total) {
                joinerState.playback.currentTime = total;
            }
            scrubber.value = joinerState.playback.currentTime;
        }
    }

    function updateOriginalResolutionOption() {
        const optOriginal = document.getElementById('joiner-opt-original');
        if (!optOriginal) return;

        if (joinerState.items.length === 0) {
            optOriginal.textContent = 'Oryginalna (największy plik): Brak plików';
            return;
        }

        let maxW = 0;
        let maxH = 0;
        joinerState.items.forEach(item => {
            if (item.width > maxW) maxW = item.width;
            if (item.height > maxH) maxH = item.height;
        });

        optOriginal.textContent = `Oryginalna (największy plik): ${maxW} × ${maxH}`;
    }

    /* =========================================================================
     * 4. SZYBKI PODGLĄD ODTWARZACZA (MINI PLAYER & SCRUBBER)
     * ========================================================================= */
    function setupJoinerControls() {
        const btnPlay = document.getElementById('btn-joiner-play');
        const btnStop = document.getElementById('btn-joiner-stop');
        const btnRewind = document.getElementById('btn-joiner-rewind');
        const scrubber = document.getElementById('joiner-player-scrubber');
        const resSelect = document.getElementById('joiner-export-resolution');
        const customResRow = document.getElementById('joiner-custom-res-row');

        if (btnPlay) {
            btnPlay.addEventListener('click', togglePlayback);
        }

        if (btnStop) {
            btnStop.addEventListener('click', () => {
                pausePlayback();
                joinerState.playback.currentTime = 0;
                updateScrubberPosition();
                updatePreviewFrame();
            });
        }

        if (btnRewind) {
            btnRewind.addEventListener('click', () => {
                joinerState.playback.currentTime = 0;
                updateScrubberPosition();
                updatePreviewFrame();
            });
        }

        if (scrubber) {
            scrubber.addEventListener('input', (e) => {
                pausePlayback();
                joinerState.playback.currentTime = parseFloat(e.target.value) || 0;
                updatePreviewFrame();
            });
        }

        if (resSelect && customResRow) {
            resSelect.addEventListener('change', () => {
                if (resSelect.value === 'custom') {
                    customResRow.style.display = 'flex';
                } else {
                    customResRow.style.display = 'none';
                }
            });
        }

        const fitSelect = document.getElementById('joiner-fit-mode');
        if (fitSelect) {
            fitSelect.addEventListener('change', updatePreviewFrame);
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
        if (btnPlay) btnPlay.textContent = '⏸️ Pauza';

        const loop = (timestamp) => {
            if (!joinerState.playback.isPlaying) return;

            const delta = (timestamp - joinerState.playback.lastTimestamp) / 1000;
            joinerState.playback.lastTimestamp = timestamp;

            joinerState.playback.currentTime += delta;
            if (joinerState.playback.currentTime >= total) {
                joinerState.playback.currentTime = 0;
            }

            updateScrubberPosition();
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
        if (btnPlay) btnPlay.textContent = '▶️ Odtwórz';
    }

    function updateScrubberPosition() {
        const scrubber = document.getElementById('joiner-player-scrubber');
        const timeCurrent = document.getElementById('joiner-time-current');

        if (scrubber) scrubber.value = joinerState.playback.currentTime;
        if (timeCurrent) timeCurrent.textContent = formatTime(joinerState.playback.currentTime);
    }

    function getActiveClipAtTime(targetTime) {
        let accTime = 0;
        for (let i = 0; i < joinerState.items.length; i++) {
            const item = joinerState.items[i];
            const startTime = accTime;
            const endTime = accTime + item.duration;
            if (targetTime >= startTime && targetTime < endTime) {
                return {
                    item,
                    index: i,
                    localTime: targetTime - startTime,
                    startTime,
                    endTime
                };
            }
            accTime = endTime;
        }

        if (joinerState.items.length > 0 && targetTime >= accTime) {
            const last = joinerState.items[joinerState.items.length - 1];
            return {
                item: last,
                index: joinerState.items.length - 1,
                localTime: last.duration,
                startTime: accTime - last.duration,
                endTime: accTime
            };
        }

        return null;
    }

    function updatePreviewFrame() {
        const canvas = document.getElementById('joiner-preview-canvas');
        const activeClipLabel = document.getElementById('joiner-active-clip-label');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        if (joinerState.items.length === 0) {
            ctx.fillStyle = '#05070d';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '16px Plus Jakarta Sans, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Wgraj zdjęcia lub wideo powyżej', canvas.width / 2, canvas.height / 2);
            if (activeClipLabel) activeClipLabel.textContent = 'Brak plików';
            return;
        }

        const active = getActiveClipAtTime(joinerState.playback.currentTime);
        if (!active) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const item = active.item;
        if (activeClipLabel) {
            activeClipLabel.textContent = `Plik ${active.index + 1}/${joinerState.items.length}: ${item.name}`;
        }

        const fitSelect = document.getElementById('joiner-fit-mode');
        const fitMode = fitSelect ? fitSelect.value : 'letterbox';

        if (item.type === 'image') {
            const img = new Image();
            img.src = item.url;
            if (img.complete && img.naturalWidth > 0) {
                drawMediaToCanvas(ctx, img, img.naturalWidth, img.naturalHeight, canvas.width, canvas.height, fitMode);
            } else {
                img.onload = () => {
                    drawMediaToCanvas(ctx, img, img.naturalWidth, img.naturalHeight, canvas.width, canvas.height, fitMode);
                };
            }
        } else if (item.type === 'video') {
            let vid = joinerState.videoElementsCache.get(item.url);
            if (!vid) {
                vid = document.createElement('video');
                vid.src = item.url;
                vid.muted = true;
                vid.playsInline = true;
                joinerState.videoElementsCache.set(item.url, vid);
            }

            const targetVidTime = item.duration > 0 ? (active.localTime % item.duration) : 0;
            if (Math.abs(vid.currentTime - targetVidTime) > 0.08) {
                vid.currentTime = targetVidTime;
            }

            drawMediaToCanvas(ctx, vid, vid.videoWidth || item.width, vid.videoHeight || item.height, canvas.width, canvas.height, fitMode);
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
     * 5. USTAWIENIA I EKSPORT DO MP4
     * ========================================================================= */
    function setupJoinerExport() {
        const btnExportTop = document.getElementById('btn-joiner-export-top');
        const btnExportMain = document.getElementById('btn-joiner-export-main');

        if (btnExportTop) btnExportTop.addEventListener('click', startSequenceExport);
        if (btnExportMain) btnExportMain.addEventListener('click', startSequenceExport);

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

        if (btnClose) btnClose.addEventListener('click', hideExportModal);

        if (btnDownloadAgain) {
            btnDownloadAgain.addEventListener('click', () => {
                if (joinerState.export.resultBlob) {
                    downloadBlob(joinerState.export.resultBlob, 'zlaczony_film.mp4');
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
                joinerState.items.forEach(i => {
                    if (i.width > maxW) maxW = i.width;
                    if (i.height > maxH) maxH = i.height;
                });
                return { width: maxW || 1920, height: maxH || 1080 };
            }
            case '4k':
                return { width: 3840, height: 2160 };
            case 'fhd':
                return { width: 1920, height: 1080 };
            case 'hd':
                return { width: 1280, height: 720 };
            case 'a4-v':
                return { width: 2480, height: 3508 };
            case 'a4-h':
                return { width: 3508, height: 2480 };
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
        if (joinerState.items.length === 0) {
            alert('Wgraj najpierw zdjęcia lub wideo, aby utworzyć film!');
            return;
        }

        if (joinerState.export.isExporting) return;

        pausePlayback();

        const totalDuration = getTotalDuration();
        if (totalDuration <= 0) {
            alert('Czas trwania filmu musi być większy od zera.');
            return;
        }

        const dims = getExportDimensions();
        const fpsSelect = document.getElementById('joiner-fps-select');
        const fps = fpsSelect ? parseInt(fpsSelect.value) : 30;
        const totalFrames = Math.max(1, Math.round(totalDuration * fps));

        const fitSelect = document.getElementById('joiner-fit-mode');
        const fitMode = fitSelect ? fitSelect.value : 'letterbox';

        showExportModal(totalFrames);
        joinerState.export.isExporting = true;
        joinerState.export.cancelRequested = false;

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = dims.width;
        exportCanvas.height = dims.height;
        // Dołącz canvas do drzewa DOM poza ekranem - zapewnia stały kompozytor GPU i eliminuje dławienie klatek przez Chromium
        exportCanvas.style.position = 'fixed';
        exportCanvas.style.left = '-99999px';
        exportCanvas.style.top = '0';
        exportCanvas.style.width = `${dims.width}px`;
        exportCanvas.style.height = `${dims.height}px`;
        exportCanvas.style.opacity = '1';
        exportCanvas.style.visibility = 'visible';
        exportCanvas.style.pointerEvents = 'none';
        document.body.appendChild(exportCanvas);

        const cleanupExportCanvas = () => {
            if (exportCanvas && exportCanvas.parentNode) {
                exportCanvas.parentNode.removeChild(exportCanvas);
            }
        };

        const ctx = exportCanvas.getContext('2d', { alpha: false });

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
        } catch (e) {
            cleanupExportCanvas();
            alert('Błąd MediaRecorder: ' + e.message);
            hideExportModal();
            joinerState.export.isExporting = false;
            return;
        }

        recorder.start(250);

        // Preload obrazów do pamięci podręcznej
        const imageElements = new Map();
        for (const item of joinerState.items) {
            if (item.type === 'image' && !imageElements.has(item.url)) {
                const img = new Image();
                img.src = item.url;
                await new Promise(r => {
                    if (img.complete) r();
                    else img.onload = img.onerror = r;
                });
                imageElements.set(item.url, img);
            } else if (item.type === 'video') {
                let vid = joinerState.videoElementsCache.get(item.url);
                if (!vid) {
                    vid = document.createElement('video');
                    vid.src = item.url;
                    vid.muted = true;
                    vid.playsInline = true;
                    joinerState.videoElementsCache.set(item.url, vid);
                }
                vid.pause();
                vid.currentTime = 0;
                if (vid.readyState < 2) {
                    await new Promise(r => {
                        const onLoaded = () => { vid.removeEventListener('loadeddata', onLoaded); r(); };
                        vid.addEventListener('loadeddata', onLoaded, { once: true });
                        setTimeout(r, 600);
                    });
                }
            }
        }

        const exportStartTime = performance.now();
        let lastReportTime = exportStartTime;
        const frameDurationMs = 1000 / fps;
        let activeVideo = null;
        let activeClipIndex = -1;

        for (let frame = 0; frame < totalFrames; frame++) {
            if (joinerState.export.cancelRequested) break;

            const currentTime = frame / fps;
            const active = getActiveClipAtTime(currentTime);

            if (active) {
                const item = active.item;
                const clipIdx = active.index;

                if (clipIdx !== activeClipIndex) {
                    if (activeVideo && activeVideo !== joinerState.videoElementsCache.get(item.url)) {
                        activeVideo.pause();
                        activeVideo = null;
                    }
                    activeClipIndex = clipIdx;

                    if (item.type === 'video') {
                        const vid = joinerState.videoElementsCache.get(item.url);
                        if (vid) {
                            vid.pause();
                            vid.currentTime = 0;
                            try {
                                await vid.play();
                            } catch(e) {}
                            activeVideo = vid;
                        }
                    }
                }

                if (item.type === 'image') {
                    const img = imageElements.get(item.url);
                    if (img) {
                        drawMediaToCanvas(ctx, img, img.naturalWidth, img.naturalHeight, dims.width, dims.height, fitMode);
                    }
                } else if (item.type === 'video') {
                    const vid = joinerState.videoElementsCache.get(item.url);
                    if (vid) {
                        if (vid.paused && vid.currentTime < vid.duration - 0.05) {
                            try { await vid.play(); } catch(e) {}
                        }
                        const expectedLocalTime = active.localTime;
                        if (Math.abs(vid.currentTime - expectedLocalTime) > 0.25) {
                            vid.currentTime = expectedLocalTime;
                        }
                        drawMediaToCanvas(ctx, vid, vid.videoWidth || item.width, vid.videoHeight || item.height, dims.width, dims.height, fitMode);
                    }
                }
            } else {
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, dims.width, dims.height);
            }

            if (streamTrack && typeof streamTrack.requestFrame === 'function') {
                try { streamTrack.requestFrame(); } catch(e) {}
            }

            // Precyzyjne taktowanie zegara klatek - gwarantuje stały klatkaż bez spadków na długich filmach
            const targetElapsedMs = (frame + 1) * frameDurationMs;
            const currentElapsedMs = performance.now() - exportStartTime;
            const delayMs = targetElapsedMs - currentElapsedMs;
            if (delayMs > 1) {
                await new Promise(r => setTimeout(r, delayMs));
            } else if (frame % 4 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }

            const now = performance.now();
            if (now - lastReportTime > 80 || frame === totalFrames - 1) {
                lastReportTime = now;
                const percent = Math.round(((frame + 1) / totalFrames) * 100);
                const elapsedSec = (now - exportStartTime) / 1000;
                const speedFps = (frame + 1) / (elapsedSec || 0.001);

                updateExportModalProgress(frame + 1, totalFrames, percent, speedFps.toFixed(1));
            }
        }

        if (activeVideo) {
            activeVideo.pause();
            activeVideo = null;
        }

        if (joinerState.export.cancelRequested) {
            cleanupExportCanvas();
            joinerState.export.isExporting = false;
            return;
        }

        updateExportModalStatus('Finalizowanie pliku MP4...');
        await new Promise(r => setTimeout(r, 200));

        recorder.onstop = async () => {
            cleanupExportCanvas();
            let finalBlob = new Blob(chunks, { type: mimeType });

            if (mimeType.includes('webm') && typeof window.fixWebmDuration === 'function' && finalBlob.size > 40) {
                try {
                    finalBlob = await window.fixWebmDuration(finalBlob, totalDuration * 1000);
                } catch (e) {
                    console.warn(e);
                }
            }

            joinerState.export.resultBlob = finalBlob;
            joinerState.export.isExporting = false;

            downloadBlob(finalBlob, 'zlaczony_film.mp4');
            showExportSuccess(finalBlob);
        };

        if (recorder.state === 'recording') {
            try { recorder.requestData(); } catch(e) {}
            setTimeout(() => {
                if (recorder.state === 'recording') recorder.stop();
            }, 100);
        }
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

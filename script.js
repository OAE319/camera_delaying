// 等待 HTML 載入完成
window.addEventListener('load', () => {

    // --- A. 取得 HTML 元素 ---
    const video = document.getElementById('video-feed');
    const canvas = document.getElementById('display-canvas');
    const ctx = canvas.getContext('2d');
    const controlsUI = document.querySelector('.controls');

    // UI 控制項
    const durationSlider = document.getElementById('duration-slider');
    const durationLabel = document.getElementById('duration-label');
    const slicesSlider = document.getElementById('slices-slider');
    const slicesLabel = document.getElementById('slices-label');

    // --- B. 全域變數 ---
    let sliceCount = 5;
    let bufferDurationSeconds = 1.0;
    
    // **[閃退修正]** Ring Buffer 相關變數
    const MAX_SAFE_FRAMES = 180; // 最大緩衝幀數 (約 3s @ 60fps)
    let frameBufferPool = [];    // 預先建立的 Canvas "池"
    let currentBufferIndex = 0;  // 目前寫入到 "池" 的索引
    let framesFilled = 0;        // 目前 "池" 中有多少幀
    let maxBufferSize = 60;      // 使用者想要的緩衝大小

    // --- C. 啟動 Ring Buffer ---
    // **[閃退修正]** 預先建立所有 Canvas 元素
    function initializeBufferPool(width, height) {
        console.log(`正在初始化 Ring Buffer ( ${MAX_SAFE_FRAMES} 幀, ${width}x${height} )...`);
        frameBufferPool = []; // 清空舊的 (如果有的話)
        for (let i = 0; i < MAX_SAFE_FRAMES; i++) {
            const bufferCanvas = document.createElement('canvas');
            bufferCanvas.width = width;
            bufferCanvas.height = height;
            frameBufferPool.push(bufferCanvas);
        }
        currentBufferIndex = 0;
        framesFilled = 0;
    }

    // --- D. 啟動相機 ---
    async function setupCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 }
                }
            });

            video.srcObject = stream;
            video.play();

            video.onloadedmetadata = () => {
                console.log(`相機已啟動, 解析度: ${video.videoWidth}x${video.videoHeight}`);
                
                // **[閃退修正]** 根據相機的真實解析度，初始化 Ring Buffer
                initializeBufferPool(video.videoWidth, video.videoHeight);
                
                // **[拉伸修正]** 呼叫 handleResize 來設定初始畫布大小
                handleResize(); 
                
                window.addEventListener('resize', handleResize); 
                renderLoop();
            };

        } catch (err) {
            console.error("相機啟動失敗:", err);
            alert("無法存取相機。請檢查權限並確保使用 HTTPS 連線。");
        }
    }
    
    // **[拉伸修正]** 重寫 handleResize
    function handleResize() {
        // 讓 Canvas 的 "drawable" 解析度 1:1 匹配螢幕的 "CSS" 像素
        // 乘以 devicePixelRatio 畫質更銳利 (可選，但建議)
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;

        // 我們不再需要 CSS object-fit，所以要把 CSS 上的設定移除
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;

        console.log(`Canvas resized to (drawable): ${canvas.width}x${canvas.height}`);
    }

    // **[拉伸修正]** 繪圖的核心：手動實作 "object-fit: cover"
    function drawImageCover(context, image) {
        const imgWidth = image.videoWidth || image.width;
        const imgHeight = image.videoHeight || image.height;
        const canvasWidth = context.canvas.width;
        const canvasHeight = context.canvas.height;

        // 1. 計算縮放比例
        const hRatio = canvasWidth / imgWidth;
        const vRatio = canvasHeight / imgHeight;
        const ratio = Math.max(hRatio, vRatio); // "Cover" 的關鍵：取較大的比例

        // 2. 計算縮放後的影像尺寸
        const scaledImgWidth = imgWidth * ratio;
        const scaledImgHeight = imgHeight * ratio;

        // 3. 計算置中的偏移量
        const centerShiftX = (canvasWidth - scaledImgWidth) / 2;
        const centerShiftY = (canvasHeight - scaledImgHeight) / 2;

        // 4. 繪製
        context.drawImage(image, centerShiftX, centerShiftY, scaledImgWidth, scaledImgHeight);
    }

    // --- E. 更新控制項參數 ---
    function updateParameters() {
        bufferDurationSeconds = parseFloat(durationSlider.value);
        durationLabel.textContent = bufferDurationSeconds.toFixed(1);
        
        let requestedFrames = Math.round(bufferDurationSeconds * 60);

        if (requestedFrames > MAX_SAFE_FRAMES) {
            maxBufferSize = MAX_SAFE_FRAMES;
            durationLabel.textContent = `上限 ${(MAX_SAFE_FRAMES / 60).toFixed(1)}s`; 
        } else {
            maxBufferSize = requestedFrames;
        }

        sliceCount = parseInt(slicesSlider.value);
        slicesLabel.textContent = sliceCount;
    }

    // --- F. 影像緩衝邏輯 (使用 Ring Buffer) ---
    // **[閃退修正]** 重寫 captureFrameToBuffer
    function captureFrameToBuffer() {
        // 1. 從 "池" 中取得一個 "可回收" 的 canvas
        const bufferCanvas = frameBufferPool[currentBufferIndex];
        const bufferCtx = bufferCanvas.getContext('2d');
        
        // 2. 把當前 video 畫面畫到這個 canvas 上
        // (注意：這裡不需要 "Cover" 邏輯，因為 bufferCanvas 和 video 解析度一樣)
        bufferCtx.drawImage(video, 0, 0); 
        
        // 3. 更新 Ring Buffer 索引
        currentBufferIndex = (currentBufferIndex + 1) % MAX_SAFE_FRAMES;
        
        // 4. 更新已填充的幀數
        if (framesFilled < MAX_SAFE_FRAMES) {
            framesFilled++;
        }
    }

    // --- G. 影像疊合邏輯 (使用 Ring Buffer) ---
    // **[閃退修正]** 重寫 compositeFrames
    function compositeFrames() {
        if (framesFilled === 0) return; // 緩衝區是空的

        // 1. 清空主畫布
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 2. 計算透明度
        const alpha = 1.0 / (sliceCount + 1);
        ctx.globalAlpha = alpha;

        // 3. 繪製緩衝區中的 y 張圖片
        const totalFramesInUse = Math.min(framesFilled, maxBufferSize);
        if (totalFramesInUse > 1) {
            const step = (totalFramesInUse - 1) / (sliceCount - 1);
            
            for (let i = 0; i < sliceCount; i++) {
                let index = 0;
                if (i === 0) {
                    index = 0; // 第一張 (最舊的)
                } else {
                    index = Math.round(i * step);
                }

                // **Ring Buffer 的取用邏輯**
                // ( currentBufferIndex - totalFramesInUse + index + MAX_SAFE_FRAMES ) % MAX_SAFE_FRAMES
                // 這能正確找到第 index 舊的幀
                let bufferPoolIndex = (currentBufferIndex - totalFramesInUse + index + MAX_SAFE_FRAMES) % MAX_SAFE_FRAMES;
                
                const frameToDraw = frameBufferPool[bufferPoolIndex];
                
                // **[拉伸修正]** 使用 drawImageCover 繪製
                drawImageCover(ctx, frameToDraw);
            }
        }
        
        // 4. 繪製「當前」的影像
        // **[拉伸修正]** 使用 drawImageCover 繪製
        drawImageCover(ctx, video);
        
        // 5. 恢復透明度
        ctx.globalAlpha = 1.0;
    }


    // --- H. 渲染迴圈 (App 的心跳) ---
    function renderLoop() {
        if (!video.paused && !video.ended) {
            updateParameters();
            captureFrameToBuffer();
            compositeFrames();
        }
        // 請求下一次繪製
        requestAnimationFrame(renderLoop);
    }

    // --- I. 啟動 App ---
    durationSlider.addEventListener('input', updateParameters);
    slicesSlider.addEventListener('input', updateParameters);
    
    // **[UI 修正]** 改用 'touchend'
    canvas.addEventListener('touchend', (e) => {
        // 阻止 'click' 事件被觸發兩次
        e.preventDefault(); 
        controlsUI.classList.toggle('hidden');
        console.log("UI Toggled"); // 供你偵錯
    });
    
    // 啟動相機
    setupCamera();
});

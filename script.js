// 等待 HTML 載入完成
window.addEventListener('load', () => {

    // --- A. 取得 HTML 元素 ---
    const video = document.getElementById('video-feed');
    const canvas = document.getElementById('display-canvas');
    const ctx = canvas.getContext('2d');
    const controlsUI = document.querySelector('.controls'); // **[新]** 取得控制項 UI

    // UI 控制項
    const durationSlider = document.getElementById('duration-slider');
    const durationLabel = document.getElementById('duration-label');
    const slicesSlider = document.getElementById('slices-slider');
    const slicesLabel = document.getElementById('slices-label');

    // --- B. 全域變數 ---
    let frameBuffer = []; 
    let bufferDurationSeconds = 1.0;
    let sliceCount = 5;
    
    // **[Bug 3 修正]** 設定安全上限 (180 幀 ≈ 3 秒 @ 60fps)
    const MAX_SAFE_FRAMES = 180; 
    let maxBufferSize = 60; 

    // --- C. 啟動相機 ---
    async function setupCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'environment',
                    // **[Bug 3 修正]** 降低解析度以節省大量記憶體
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 }
                }
            });

            video.srcObject = stream;
            video.play();

            video.onloadedmetadata = () => {
                console.log("相機已啟動");
                
                // **[Bug 1 修正]** 呼叫 handleResize 來設定初始畫布大小
                handleResize(); 
                
                // **[Bug 1 修正]** 監聽視窗大小變化 (包含手機旋轉)
                window.addEventListener('resize', handleResize); 
                
                renderLoop();
            };

        } catch (err) {
            console.error("相機啟動失敗:", err);
            alert("無法存取相機。請檢查權限並確保使用 HTTPS 連線。");
        }
    }
    
    // **[Bug 1 修正] 新增 handleResize 函式**
    function handleResize() {
        // 這是修正拉伸的關鍵：
        // 讓 Canvas 的 "解析度" 永遠 1:1 等於 Video 影像的 "解析度"
        // CSS 的 object-fit 會自動處理縮放，但前提是 Canvas 自身的解析度必須正確
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        console.log(`Canvas resized to: ${canvas.width}x${canvas.height}`);
    }


    // --- D. 更新控制項參數 ---
    function updateParameters() {
        bufferDurationSeconds = parseFloat(durationSlider.value);
        durationLabel.textContent = bufferDurationSeconds.toFixed(1);
        
        let requestedFrames = Math.round(bufferDurationSeconds * 60);

        // **[Bug 3 修正]** 檢查是否超過安全上限
        if (requestedFrames > MAX_SAFE_FRAMES) {
            maxBufferSize = MAX_SAFE_FRAMES;
            // 提醒使用者已達上限
            durationLabel.textContent = `上限 ${(MAX_SAFE_FRAMES / 60).toFixed(1)}s`; 
        } else {
            maxBufferSize = requestedFrames;
        }

        sliceCount = parseInt(slicesSlider.value);
        slicesLabel.textContent = sliceCount;
    }

    // --- E. 影像緩衝邏輯 ---
    function captureFrameToBuffer() {
        // (此處邏輯不變，但因為解析度降低了，記憶體壓力已大幅減輕)
        
        const bufferCanvas = document.createElement('canvas');
        bufferCanvas.width = canvas.width;
        bufferCanvas.height = canvas.height;
        const bufferCtx = bufferCanvas.getContext('2d');
        
        bufferCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        frameBuffer.push(bufferCanvas);
        
        while (frameBuffer.length > maxBufferSize) {
            frameBuffer.shift(); 
        }
    }

    // --- F. 影像疊合邏輯 (核心！) ---
    function compositeFrames() {
        if (frameBuffer.length === 0) return; 

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const alpha = 1.0 / (sliceCount + 1);
        ctx.globalAlpha = alpha;

        const totalFrames = frameBuffer.length;
        if (totalFrames > 1) {
            const step = (totalFrames - 1) / (sliceCount - 1);
            
            for (let i = 0; i < sliceCount; i++) {
                let index = 0;
                if (i === 0) {
                    index = 0; 
                } else {
                    index = Math.round(i * step);
                }
                
                if (index < frameBuffer.length) {
                    const frameToDraw = frameBuffer[index];
                    ctx.drawImage(frameToDraw, 0, 0, canvas.width, canvas.height);
                }
            }
        }
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        ctx.globalAlpha = 1.0;
    }


    // --- G. 渲染迴圈 (App 的心跳) ---
    function renderLoop() {
        updateParameters();
        captureFrameToBuffer();
        compositeFrames();
        requestAnimationFrame(renderLoop);
    }

    // --- H. 啟動 App ---
    durationSlider.addEventListener('input', updateParameters);
    slicesSlider.addEventListener('input', updateParameters);
    
    // **[Bug 2 修正]** 點擊畫布來切換 UI 顯示/隱藏
    canvas.addEventListener('click', () => {
        controlsUI.classList.toggle('hidden');
    });
    
    setupCamera();
});
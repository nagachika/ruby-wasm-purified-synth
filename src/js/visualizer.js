export function setupVisualizer(vm) {
  const canvas = document.getElementById("visualizer");
  const canvasCtx = canvas.getContext("2d");
  const bufferLength = 1024;
  const dataArray = new Uint8Array(bufferLength);
  let vizMode = "waveform";

  document.querySelectorAll('input[name="viz_mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      vizMode = e.target.value;
    });
  });

  function draw() {
    requestAnimationFrame(draw);
    const analyser = window.synthAnalyser;
    if (!analyser) return;

    canvasCtx.fillStyle = "rgb(20, 20, 20)";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = "rgb(77, 171, 247)";
    canvasCtx.fillStyle = "rgb(77, 171, 247)";

    if (vizMode === "waveform") {
      analyser.getByteTimeDomainData(dataArray);
      canvasCtx.beginPath();
      const sliceWidth = canvas.width * 1.0 / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;
        if (i === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);
        x += sliceWidth;
      }
      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    } else {
      analyser.getByteFrequencyData(dataArray);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 255.0 * canvas.height;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    }
  }
  draw();
}

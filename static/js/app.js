/**
 * app.js: Integrated AI Interviewer with Face Tracking
 */

// =======================
// Global State
// =======================
const sessionId = Math.random().toString().substring(10);
const base_url = "http://" + window.location.host;
const sse_url = base_url + "/events/" + sessionId;
const send_url = base_url + "/send/" + sessionId;
const setup_url = base_url + "/setup/" + sessionId;

let eventSource = null;
let is_audio = false;
let currentMessageId = null;

// DOM elements
const setupForm = document.getElementById("setupForm");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("message");
const messagesDiv = document.getElementById("messages");
const startAudioButton = document.getElementById("startAudioButton");
const sendButton = document.getElementById("sendButton");
const connectionStatus = document.getElementById("connectionStatus");
const audioStatus = document.getElementById("audioStatus");

// =======================
// Face Tracking Setup
// =======================
const videoElement = document.createElement("video");
videoElement.setAttribute("playsinline", "");
videoElement.setAttribute("muted", "");
videoElement.setAttribute("autoplay", "");

const canvasElement = document.getElementById("output");
const canvasCtx = canvasElement.getContext("2d");
const statusDiv = document.getElementById("status");

function calculateHeadPose(landmarks) {
  const leftEye = landmarks[33];   // left eye
  const rightEye = landmarks[263]; // right eye
  const noseTip = landmarks[1];    // nose tip

  // distance between eyes in 2D
  const eyeDist = Math.hypot(
    rightEye.x - leftEye.x,
    rightEye.y - leftEye.y
  );

  // --- Yaw (left/right) ---
  const noseOffsetX = noseTip.x - (leftEye.x + rightEye.x) / 2;
  const yAngle = (noseOffsetX / eyeDist) * 60;

  // --- Pitch (up/down) ---
  const noseToEyeVertical = noseTip.y - (leftEye.y + rightEye.y) / 2;
  let xAngle = (noseToEyeVertical / eyeDist) * 40;

  // add smaller z correction
  const avgEyeZ = (leftEye.z + rightEye.z) / 2;
  const zOffset = noseTip.z - avgEyeZ;
  xAngle += (zOffset * 40);

  return [xAngle, yAngle];
}

function onResults(results) {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];
    const [xAngle, yAngle] = calculateHeadPose(landmarks);

    // Status detection using your original logic
    if (xAngle > 26.5 && yAngle > -4) {
      statusDiv.textContent = "❌ Not Looking Forward";
      statusDiv.style.color = "#ff6b6b";
      statusDiv.style.background = "rgba(255,107,107,0.2)";
    } else if (xAngle > 24.5 && yAngle < 7) {
      statusDiv.textContent = "❌ Not Looking Forward";
      statusDiv.style.color = "#ff6b6b";
      statusDiv.style.background = "rgba(255,107,107,0.2)";
    } else if (yAngle < -15 || yAngle > 15 || 
               xAngle < 15 || xAngle > 23) {
      statusDiv.textContent = "❌ Not Looking Forward";
      statusDiv.style.color = "#ff6b6b";
      statusDiv.style.background = "rgba(255,107,107,0.2)";
    } else {
      statusDiv.textContent = "✅ Looking Forward";
      statusDiv.style.color = "#00ff7f";
      statusDiv.style.background = "rgba(0,255,127,0.2)";
    }
  } else {
    statusDiv.textContent = "No face detected";
    statusDiv.style.color = "#ffa500";
    statusDiv.style.background = "rgba(255,165,0,0.2)";
  }
  canvasCtx.restore();
}

const faceMesh = new FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
});

faceMesh.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await faceMesh.send({ image: videoElement });
  },
  width: 640,
  height: 480,
});

// Start camera immediately
camera.start().then(() => {
  statusDiv.textContent = "Camera ready - waiting for face detection";
  statusDiv.style.color = "#64b5f6";
}).catch((err) => {
  console.error("Camera start error:", err);
  statusDiv.textContent = "❌ Camera access denied";
  statusDiv.style.color = "#ff6b6b";
});

// =======================
// Sidebar toggle
// =======================
const sidebar = document.getElementById("sidebar");
document.getElementById("toggleSidebar").addEventListener("click", () => {
  sidebar.classList.toggle("hidden");
});

// =======================
// Interview Setup
// =======================
setupForm.onsubmit = async function (e) {
  e.preventDefault();
  const jobDescription = document.getElementById("jobDescription").value;
  const resume = document.getElementById("resume").value;

  if (!jobDescription || !resume) {
    alert("Please enter both Job Description and Resume.");
    return;
  }

  connectionStatus.textContent = "Status: Setting up interview...";
  connectionStatus.style.background = "#fff3cd";

  try {
    const response = await fetch(setup_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_description: jobDescription,
        candidate_resume: resume,
      }),
    });

    if (response.ok) {
      console.log("Interview setup complete.");
      connectionStatus.textContent = "Status: Interview setup complete";
      connectionStatus.style.background = "#d4edda";
      connectSSE(); // Now connect after setup
      startAudioButton.disabled = false;
    } else {
      console.error("Setup failed:", response.statusText);
      connectionStatus.textContent = `Status: Setup failed (${response.statusText})`;
      connectionStatus.style.background = "#f8d7da";
      appendMessage("system", "Setup failed: " + response.statusText);
    }
  } catch (error) {
    console.error("Setup error:", error);
    connectionStatus.textContent = "Status: Setup error - check connection";
    connectionStatus.style.background = "#f8d7da";
    appendMessage("system", "Error during setup: " + error.message);
  }
};

// =======================
// SSE Connection (Original Working Structure)
// =======================
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }
  
  eventSource = new EventSource(sse_url + "?is_audio=" + is_audio);

  eventSource.onopen = function () {
    console.log("SSE connection opened.");
    connectionStatus.textContent = "Status: Connected";
    connectionStatus.style.background = "#d4edda";
    sendButton.disabled = false;
    addSubmitHandler();
  };

  eventSource.onmessage = function (event) {
    const message_from_server = JSON.parse(event.data);
    console.log("[AGENT TO CLIENT] ", message_from_server);

    if (message_from_server.turn_complete) {
      currentMessageId = null;
      return;
    }

    if (message_from_server.interrupted) {
      if (audioPlayerNode) {
        audioPlayerNode.port.postMessage({ command: "endOfAudio" });
      }
      return;
    }

    if (message_from_server.mime_type == "audio/pcm" && audioPlayerNode) {
      audioPlayerNode.port.postMessage(
        base64ToArray(message_from_server.data)
      );
    }

    if (message_from_server.mime_type == "text/plain") {
      if (currentMessageId == null) {
        currentMessageId = Math.random().toString(36).substring(7);
        const message = document.createElement("div");
        message.className = "message bot";
        message.id = currentMessageId;
        messagesDiv.appendChild(message);
      }
      const message = document.getElementById(currentMessageId);
      message.textContent += message_from_server.data;
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  };

  eventSource.onerror = function () {
    console.log("SSE connection error or closed.");
    connectionStatus.textContent = "Status: Connection error";
    connectionStatus.style.background = "#f8d7da";
    sendButton.disabled = true;
    eventSource.close();
    setTimeout(() => {
      if (eventSource.readyState === EventSource.CLOSED) {
        connectSSE();
      }
    }, 5000);
  };
}

// =======================
// Message Handling
// =======================
function addSubmitHandler() {
  messageForm.onsubmit = function (e) {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (message) {
      appendMessage("user", message);
      messageInput.value = "";
      sendMessage({
        mime_type: "text/plain",
        data: message,
      });
      console.log("[CLIENT TO AGENT] " + message);
    }
    return false;
  };
}

function appendMessage(sender, text) {
  const div = document.createElement("div");
  div.className = "message " + sender;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendMessage(message) {
  try {
    const response = await fetch(send_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.error("Failed to send message:", response.statusText);
      appendMessage("system", "Failed to send message: " + response.statusText);
    }
  } catch (error) {
    console.error("Error sending message:", error);
    appendMessage("system", "Error sending message: " + error.message);
  }
}

// =======================
// Audio Setup (Original Working Structure)
// =======================
let audioPlayerNode;
let audioPlayerContext;
let audioRecorderNode;
let audioRecorderContext;
let micStream;
let audioBuffer = [];
let bufferTimer = null;

// Import audio worklets (you need these files!)
import { startAudioPlayerWorklet } from "./audio-player.js";
import { startAudioRecorderWorklet } from "./audio-recorder.js";

function startAudio() {
  audioStatus.textContent = "Audio: Initializing...";
  audioStatus.style.background = "#fff3cd";
  
  startAudioPlayerWorklet().then(([node, ctx]) => {
    audioPlayerNode = node;
    audioPlayerContext = ctx;
    console.log("Audio player worklet started");
  }).catch(err => {
    console.error("Audio player worklet failed:", err);
    audioStatus.textContent = "Audio: Player failed";
    audioStatus.style.background = "#f8d7da";
  });
  
  startAudioRecorderWorklet(audioRecorderHandler).then(([node, ctx, stream]) => {
    audioRecorderNode = node;
    audioRecorderContext = ctx;
    micStream = stream;
    console.log("Audio recorder worklet started");
    audioStatus.textContent = "Audio: Active";
    audioStatus.style.background = "#d4edda";
  }).catch(err => {
    console.error("Audio recorder worklet failed:", err);
    audioStatus.textContent = "Audio: Recorder failed";
    audioStatus.style.background = "#f8d7da";
  });
}

startAudioButton.addEventListener("click", () => {
  if (!is_audio) {
    startAudioButton.disabled = true;
    startAudio();
    is_audio = true;
    if (eventSource) eventSource.close();
    connectSSE();
    startAudioButton.textContent = "Stop Audio";
    startAudioButton.disabled = false;
  } else {
    // Stop audio
    is_audio = false;
    if (eventSource) eventSource.close();
    connectSSE();
    startAudioButton.textContent = "Start Audio";
    audioStatus.textContent = "Audio: Stopped";
    audioStatus.style.background = "#e9ecef";
    
    // Clean up audio resources
    if (audioRecorderContext) {
      audioRecorderContext.close();
    }
    if (audioPlayerContext) {
      audioPlayerContext.close();
    }
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
    }
    if (bufferTimer) {
      clearInterval(bufferTimer);
      bufferTimer = null;
    }
  }
});

function audioRecorderHandler(pcmData) {
  audioBuffer.push(new Uint8Array(pcmData));
  if (!bufferTimer) {
    bufferTimer = setInterval(sendBufferedAudio, 200);
  }
}

function sendBufferedAudio() {
  if (audioBuffer.length === 0) return;

  let totalLength = audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
  const combinedBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioBuffer) {
    combinedBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  sendMessage({
    mime_type: "audio/pcm",
    data: arrayBufferToBase64(combinedBuffer.buffer),
  });
  console.log("[CLIENT TO AGENT] sent %s bytes", combinedBuffer.byteLength);
  audioBuffer = [];
}

// =======================
// Utility Functions
// =======================
function base64ToArray(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// =======================
// Status Updates
// =======================
setInterval(() => {
  if (eventSource) {
    if (eventSource.readyState === EventSource.OPEN) {
      connectionStatus.textContent = `Status: Connected (${sessionId.substring(0,8)}...)`;
      connectionStatus.style.background = "#d4edda";
    } else if (eventSource.readyState === EventSource.CONNECTING) {
      connectionStatus.textContent = "Status: Connecting...";
      connectionStatus.style.background = "#fff3cd";
    } else {
      connectionStatus.textContent = "Status: Disconnected";
      connectionStatus.style.background = "#f8d7da";
    }
  }
}, 1000);
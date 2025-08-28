/**
 * app.js: JS code for the AI Interviewer streaming app.
 */

const sessionId = Math.random().toString().substring(10);
const base_url = "http://" + window.location.host;
const sse_url = base_url + "/events/" + sessionId;
const send_url = base_url + "/send/" + sessionId;
const setup_url = base_url + "/setup/" + sessionId;

let eventSource = null;
let is_audio = false;

// DOM elements
const setupForm = document.getElementById("setupForm");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("message");
const messagesDiv = document.getElementById("messages");
const startAudioButton = document.getElementById("startAudioButton");

let currentMessageId = null;

/**
 * Setup interview (admin)
 */
setupForm.onsubmit = async function (e) {
  e.preventDefault();
  const jobDescription = document.getElementById("jobDescription").value;
  const resume = document.getElementById("resume").value;

  if (!jobDescription || !resume) {
    alert("Please enter both Job Description and Resume.");
    return;
  }

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
    connectSSE(); // Now connect after setup
  } else {
    console.error("Setup failed.");
  }
};

/**
 * Connect to SSE stream
 */
function connectSSE() {
  eventSource = new EventSource(sse_url + "?is_audio=" + is_audio);

  eventSource.onopen = function () {
    console.log("SSE connection opened.");
    document.getElementById("messages").textContent = "Connection opened";
    document.getElementById("sendButton").disabled = false;
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
        const message = document.createElement("p");
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
    document.getElementById("sendButton").disabled = true;
    document.getElementById("messages").textContent = "Connection closed";
    eventSource.close();
    setTimeout(connectSSE, 5000);
  };
}

/**
 * Add submit handler for candidate messages
 */
function addSubmitHandler() {
  messageForm.onsubmit = function (e) {
    e.preventDefault();
    const message = messageInput.value;
    if (message) {
      const p = document.createElement("p");
      p.textContent = "> " + message;
      messagesDiv.appendChild(p);
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

/**
 * Send message to agent
 */
async function sendMessage(message) {
  try {
    const response = await fetch(send_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.error("Failed to send message:", response.statusText);
    }
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

/**
 * Helpers for audio
 */
function base64ToArray(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Audio setup (same as before) ---
let audioPlayerNode;
let audioPlayerContext;
let audioRecorderNode;
let audioRecorderContext;
let micStream;
let audioBuffer = [];
let bufferTimer = null;

import { startAudioPlayerWorklet } from "./audio-player.js";
import { startAudioRecorderWorklet } from "./audio-recorder.js";

function startAudio() {
  startAudioPlayerWorklet().then(([node, ctx]) => {
    audioPlayerNode = node;
    audioPlayerContext = ctx;
  });
  startAudioRecorderWorklet(audioRecorderHandler).then(
    ([node, ctx, stream]) => {
      audioRecorderNode = node;
      audioRecorderContext = ctx;
      micStream = stream;
    }
  );
}

startAudioButton.addEventListener("click", () => {
  startAudioButton.disabled = true;
  startAudio();
  is_audio = true;
  if (eventSource) eventSource.close();
  connectSSE();
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

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

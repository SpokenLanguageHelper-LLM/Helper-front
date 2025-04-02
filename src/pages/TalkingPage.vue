<template>
  <div class="talking-page">
    <div class="live2d-section">
      <div class="live2d-container">
        <div class="live2d-background"></div>
        <canvas ref="liveCanvas" class="live2d-canvas"></canvas>
      </div>
    </div>

    <div class="message-section">
      <div class="message-map">
        <MessageMap :messages="messages" />
      </div>
    </div>

    <div class="speak-control">
      <div class="speak-control-container">
        <!-- 按钮组容器 -->
        <div class="button-group">
          <!-- 录音按钮 -->
          <el-button 
            @click="openRecordingModal"
            class="control-button record-button gradient-button"
            size="large"
            color="blue"
            round>
            <el-text style="font-weight: bold; color: white; font-size: 17.5px;">Tap to Speak</el-text>
          </el-button>
          
          <!-- 播放按钮 - 修改为更小尺寸 -->
          <el-button 
            @click="playAudio"
            class="control-button play-button"
            size="small"
            type="primary"
            circle>
            <el-icon><video-play /></el-icon>
          </el-button>
        </div>
      </div>
    </div>

    <!-- 使用Element Plus对话框 -->
    <el-dialog
      v-model="showRecordingModal"
      title="Recording..."
      width="100%"
      :show-close="false"
      @close="stopRecording"
      custom-class="recording-dialog"
      :close-on-click-modal="true"
      destroy-on-close>
      <div class="voice-wave-container">
        <canvas ref="waveCanvas" class="voice-wave-canvas"></canvas>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useLive2DStore } from '../composables/useLive2D';
import { useOssStore } from '../composables/useOss';
import { storeToRefs } from 'pinia';
import { ElButton, ElDialog, ElText, ElIcon } from 'element-plus';
import { VideoPlay } from '@element-plus/icons-vue';
import MessageMap from 'src/components/MessageMap.vue';
import 'element-plus/dist/index.css';

// 使用Pinia Store
const live2dStore = useLive2DStore();
// live2dStore.showBackground("PARTS_01_BACKGROUND_02");

// 使用storeToRefs获取响应式状态
const { model, isModelLoaded } = storeToRefs(live2dStore);

// 引用canvas元素
const liveCanvas = ref(null);
const waveCanvas = ref(null);
const isRecording = ref(false);
const showRecordingModal = ref(false);
const hasRecording = ref(false);
// 存储最后一次上传录音的OSS URL
let speechRecognition = null; // 语音识别实例

const generateConversationId = () => {
  const randomPart = Math.random().toString(36).substring(2, 10);
  const timestampPart = Date.now().toString(36);
  return `conv_${randomPart}${timestampPart}`;
};

const conversation_id = generateConversationId();
// 在现有变量声明区域添加
const recognizedText = ref(''); // 存储语音识别结果
const messages = ref([
  { type: 'ai', content: "Let's start today's conversation", timestamp: Date.now() }
]);

// 使用OSS Store
const ossStore = useOssStore();

// 初始化OSS
ossStore.initialize({
  region: '',
  accessKeyId: '',
  accessKeySecret: '',
  bucket: ''
});

// 示例：添加新消息的方法（在实际应用中，这将由您的发送消息逻辑调用）
const addMessage = (type, content) => {
  messages.value.push({
    type,
    content,
    timestamp: Date.now()
  });
};

const isLoading = ref(false);

const sendRequestToBackend = async (userText, recordUrl) => {
  try {
    isLoading.value = true;
    
    // 创建一个用户消息
    messages.value.push({
      type: 'user',
      content: userText,
      timestamp: Date.now()
    });
    
    // 创建请求体
    const requestBody = {
      "conversation_id": conversation_id,
      "content": [
        {
          "type": "input_audio",
          "input_audio": {
            "data": recordUrl,
            "format": "wav",
          }
        },
        {
          "type": "text", 
          "text": userText
        }
      ]
    };
    
    // 发送POST请求到后端API
    const response = await fetch('http://localhost:8000/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // 处理流式响应
    await handleStreamingResponse(response);
    
  } catch (error) {
    console.error('发送请求失败:', error);
    // 显示错误消息
    messages.value.push({
      type: 'ai',
      content: '抱歉，处理您的请求时出现了问题，请重试。',
      timestamp: Date.now()
    });
  } finally {
    isLoading.value = false;
  }
};

// 添加音频处理相关的状态变量
let currentAudioContext = null;

// 处理流式响应的方法，同时处理text和audio
const handleStreamingResponse = async (response) => {
  // 创建一个新的AI消息
  const newMessage = {
    type: 'ai',
    content: '',
    timestamp: Date.now()
  };
  
  // 添加到消息列表
  messages.value.push(newMessage);
  
  try {
    // 获取响应的ReadableStream
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    
    // 处理流式响应
    while (true) {
      const { value, done } = await reader.read();
      
      // 如果流结束，跳出循环
      if (done) break;
      
      // 解码二进制数据为文本
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      // 寻找完整的 SSE 消息 (data: {...})
      while (true) {
        const dataStart = buffer.indexOf('data: {');
        if (dataStart === -1) break;
        
        // 从找到的'data: {'开始查找下一个换行符
        const newlineAfterData = buffer.indexOf('\n', dataStart);
        
        // 如果没找到换行符，说明消息不完整，等待更多数据
        if (newlineAfterData === -1) break;
        
        // 提取可能的JSON部分
        const jsonStart = dataStart + 6; // 'data: ' 的长度为 6
        const potentialJson = buffer.substring(jsonStart, newlineAfterData).trim();
        
        try {
          // 检查是否包含完整的JSON对象
          const lastBrace = potentialJson.lastIndexOf('}');
          if (lastBrace === -1) {
            // 如果没有找到结束括号，等待更多数据
            break;
          }
          
          // 提取可能完整的JSON
          const completeJson = potentialJson.substring(0, lastBrace + 1);
          const jsonData = JSON.parse(completeJson);
          
          // 处理text字段的数据
          if (jsonData.text !== undefined && jsonData.text !== null) {
            // 使用text字段的内容
            newMessage.content += jsonData.text;
            // 强制Vue更新视图
            messages.value = [...messages.value];
          }
          
          // 处理audio字段的数据
          if (jsonData.audio !== undefined && jsonData.audio !== null) {
            // 直接播放base64音频
            playBase64AudioDirectly(jsonData.audio);
          }
          
          // 从缓冲区中移除已处理的部分
          buffer = buffer.substring(newlineAfterData + 1);
        } catch (e) {
          console.error('JSON解析失败:', e);
          // 移除可能损坏的数据，继续处理下一条
          buffer = buffer.substring(newlineAfterData + 1);
        }
      }
    }
    
    // 处理最后可能的不完整JSON
    const lastDataIndex = buffer.lastIndexOf('data: {');
    if (lastDataIndex !== -1) {
      try {
        const jsonStr = buffer.substring(lastDataIndex + 6).trim();
        if (jsonStr && jsonStr.includes('}')) {
          const lastBrace = jsonStr.lastIndexOf('}');
          const jsonData = JSON.parse(jsonStr.substring(0, lastBrace + 1));
          
          if (jsonData.text) {
            newMessage.content += jsonData.text;
            messages.value = [...messages.value];
          }
          
          if (jsonData.audio) {
            playBase64AudioDirectly(jsonData.audio);
          }
        }
      } catch (e) {
        console.error('处理剩余数据失败:', e);
      }
    }
  } catch (error) {
    console.error('读取流式响应失败:', error);
    // 添加错误提示到消息
    newMessage.content += '\n[接收消息时出错]';
    messages.value = [...messages.value];
  }
};

// 添加音频队列管理
const audioQueue = [];
let isPlaying = false;
let currentAudioSource = null;

const playBase64AudioDirectly = (base64Data) => {
  console.log('接收到PCM音频数据，加入队列');
  
  if (!base64Data || typeof base64Data !== 'string') {
    console.error('无效的base64数据');
    return;
  }
  
  // 将新的音频数据添加到队列
  audioQueue.push(base64Data);
  
  // 如果当前没有播放中的音频，开始播放
  if (!isPlaying) {
    processAudioQueue();
  }
};

// 处理音频队列的函数
const processAudioQueue = () => {
  // 如果队列为空，标记播放结束
  if (audioQueue.length === 0) {
    isPlaying = false;
    
    // 如果有Live2D模型，可以在此处将模型切换回默认状态
    if (model.value && typeof model.value.motion === 'function') {
      try {
        model.value.motion('idle');
      } catch (err) {
        console.error('触发Live2D动作失败:', err);
      }
    }
    
    return;
  }
  
  // 标记正在播放
  isPlaying = true;
  
  // 取出队列中的第一个音频
  const base64Data = audioQueue.shift();
  
  try {
    // 1. 解码base64为二进制数据
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // 2. 转换为Int16Array (16位PCM数据)
    const pcmData = new Int16Array(bytes.buffer);
    
    // 3. 创建AudioContext
    if (!currentAudioContext || currentAudioContext.state === 'closed') {
      currentAudioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000, // 与Python代码中相同的采样率
        latencyHint: 'interactive'
      });
    } else if (currentAudioContext.state === 'suspended') {
      // 如果音频上下文被挂起，恢复它
      currentAudioContext.resume();
    }
    
    // 4. 创建适当大小和采样率的AudioBuffer
    const numChannels = 1; // 单声道
    const audioBuffer = currentAudioContext.createBuffer(
      numChannels,
      pcmData.length,
      24000 // 固定采样率为24000Hz
    );
    
    // 5. 将Int16数据复制到AudioBuffer，并转换为-1.0到1.0之间的浮点数
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcmData.length; i++) {
      // Int16 (-32768 to 32767) 转换为 Float32 (-1.0 to 1.0)
      channelData[i] = pcmData[i] / 32768.0;
    }
    
    // 6. 创建音频源并播放
    const source = currentAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(currentAudioContext.destination);
    
    // 保存当前音频源的引用
    currentAudioSource = source;
    
    console.log('音频信息:', {
      持续时间: audioBuffer.duration + '秒',
      采样率: audioBuffer.sampleRate + 'Hz',
      样本数: pcmData.length,
      队列中剩余: audioQueue.length
    });
    
    // 7. 设置播放结束回调，播放下一个音频
    source.onended = () => {
      console.log('当前音频片段播放完成');
      currentAudioSource = null;
      
      // 处理队列中的下一个音频
      setTimeout(() => {
        processAudioQueue();
      }, 1); // 添加小延迟，确保音频之间有短暂停顿
    };
    
    // 8. 播放音频
    source.start(0);
    
    // 9. 如果有Live2D模型，触发说话动作
    if (model.value && typeof model.value.motion === 'function') {
      try {
        // 仅在第一个音频片段时触发动作，避免重复触发
        if (audioQueue.length === 0 || currentAudioSource === source) {
          model.value.motion('speak');
        }
      } catch (err) {
        console.error('触发Live2D动作失败:', err);
      }
    }
    
  } catch (error) {
    console.error('PCM音频处理失败:', error);
    
    // 出错时继续处理下一个音频
    setTimeout(() => {
      processAudioQueue();
    }, 10);
  }
};

// 音频相关变量
let audioContext = null;
let analyser = null
let microphone = null;
let dataArray = null;
let frequencyData = null;
let animationFrameId = null;

// 录音相关变量
let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;
let audioUrl = null;
let audioElement = null;

// 波浪动画变量
let phase = 0;
const waveSpeed = 0.1;

// 打开录音弹窗并开始录音
const openRecordingModal = () => {
  showRecordingModal.value = true;
  // 等待对话框渲染完成后初始化录音
  nextTick(() => {
    startRecording();
  });
};

// 监听对话框状态变化
watch(showRecordingModal, (newValue) => {
  if (!newValue && isRecording.value) {
    // 如果对话框关闭但录音还在进行，停止录音
    stopRecording();
  }
});

// 初始化声纹图
const initWaveCanvas = () => {
  const canvas = waveCanvas.value;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  
  drawStaticWave(ctx, canvas.width, canvas.height);
};

// 绘制静态波浪 - 类似微信的竖条
const drawStaticWave = (ctx, width, height) => {
  ctx.clearRect(0, 0, width, height);
  
  const barCount = 30; // 条形码数量
  const barWidth = Math.max(2, Math.floor(width / (barCount * 2))); // 条形宽度
  const barGap = Math.max(1, Math.floor(width / (barCount * 3))); // 条形间距
  const defaultHeight = height * 0.15; // 默认高度（静止时）
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // 静止时为白色半透明
  
  for (let i = 0; i < barCount; i++) {
    const x = i * (barWidth + barGap) + width / 2 - (barCount * (barWidth + barGap)) / 2;
    
    // 中间高一些，两边低一些
    const barHeight = defaultHeight * (0.8 + 0.4 * Math.sin(Math.PI * i / barCount));
    
    // 圆角半径（不超过宽度一半）
    const radius = Math.min(barWidth / 2, 2);
    
    // 绘制圆角矩形
    const y = (height - barHeight) / 2;
    drawRoundedBar(ctx, x, y, barWidth, barHeight, radius);
  }
};

// 绘制动态波浪动画 - 类似微信的竖条波动
const drawWave = () => {
  if (!waveCanvas.value) return;
  
  const canvas = waveCanvas.value;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  ctx.clearRect(0, 0, width, height);
  
  // 增加相位，使动画有变化
  phase += waveSpeed;
  
  // 设置条形参数
  const barCount = 30; // 条形码数量
  const barWidth = Math.max(2, Math.floor(width / (barCount * 2))); // 条形宽度
  const barGap = Math.max(1, Math.floor(width / (barCount * 3))); // 条形间距
  const minHeight = height * 0.1; // 最小高度
  const maxHeight = height * 0.8; // 最大高度
  
  // 计算声音强度
  let intensity = 0.3; // 默认强度
  
  if (analyser && dataArray) {
    // 获取时域数据
    analyser.getByteTimeDomainData(dataArray);
    
    // 计算音频强度
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += Math.abs(dataArray[i] - 128);
    }
    intensity = Math.min(1.0, sum / dataArray.length / 20);
    
    // 获取频域数据，用于更细致的条形高度变化
    if (!frequencyData) {
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(frequencyData);
  }
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // 录音时为白色
  
  for (let i = 0; i < barCount; i++) {
    const x = i * (barWidth + barGap) + width / 2 - (barCount * (barWidth + barGap)) / 2;
    
    let barHeight;
    
    if (frequencyData) {
      // 使用频域数据计算每个条形的高度
      const frequencyIndex = Math.floor(i * frequencyData.length / barCount);
      const rawHeight = frequencyData[frequencyIndex] / 255.0;
      
      // 添加一些变化，使动画更自然
      const timeVariation = 0.2 * Math.sin(phase + i * 0.2);
      
      // 计算最终高度
      barHeight = minHeight + (maxHeight - minHeight) * Math.min(1.0, rawHeight + timeVariation);
    } else {
      // 如果没有频域数据，使用简单的正弦波
      barHeight = minHeight + (maxHeight - minHeight) * 0.5 * 
                 (1 + Math.sin(phase + i * 0.4)) * intensity;
    }
    
    // 添加圆角半径（不超过宽度一半）
    const radius = Math.min(barWidth / 2, 4);
    
    // 绘制圆角矩形替代普通矩形
    const y = (height - barHeight) / 2;
    drawRoundedBar(ctx, x, y, barWidth, barHeight, radius);
  }
  
  animationFrameId = requestAnimationFrame(drawWave);
};

const drawRoundedBar = (ctx, x, y, width, height, radius) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
};

// 开始录音同时进行语音识别
const startRecording = async () => {
  isRecording.value = true;
  recognizedText.value = ''; // 清空之前的识别结果
  
  try {
    // 延迟一帧等待DOM更新，确保waveCanvas已经渲染
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // 初始化声纹图
    initWaveCanvas();
    
    // 初始化音频环境
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
    }
    
    // 请求麦克风权限
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // 连接分析器
    if (microphone) {
      microphone.disconnect();
    }
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);
    
    // 设置录音机
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
      
      // 释放之前的URL
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      
      audioUrl = URL.createObjectURL(audioBlob);
      
      // 创建音频元素
      if (!audioElement) {
        audioElement = new Audio();
      }
      audioElement.src = audioUrl;
      
      hasRecording.value = true;
    };
    
    // 启动录音
    mediaRecorder.start();
    
    // 同时启动语音识别
    startSpeechRecognition(stream);
    
    // 开始绘制波浪动画
    drawWave();
    
  } catch (error) {
    console.error('获取麦克风权限失败:', error);
    isRecording.value = false;
    showRecordingModal.value = false;
  }
};

// 使用同一个音频流启动语音识别
const startSpeechRecognition = (stream) => {
  // 检查浏览器是否支持语音识别
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.error('浏览器不支持语音识别');
    return;
  }
  
  // 创建语音识别实例
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognition = new SpeechRecognition();
  
  // 配置语音识别
  speechRecognition.lang = 'en'; // 设置语言为中文
  speechRecognition.interimResults = true; // 允许临时结果
  speechRecognition.continuous = true; // 连续识别
  speechRecognition.maxAlternatives = 1;
  
  // 结果处理
  speechRecognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    
    // 更新识别文本
    if (finalTranscript) {
      recognizedText.value += finalTranscript + ' ';
      console.log('最终识别结果:', finalTranscript);
    }
    
    // 显示临时结果可以提高用户体验
    if (interimTranscript && !finalTranscript) {
      console.log('临时识别结果:', interimTranscript);
      // 可以选择显示临时结果
    }
  };
  
  // 错误处理
  speechRecognition.onerror = (event) => {
    console.error('语音识别错误:', event.error);
  };
  
  // 结束处理
  speechRecognition.onend = () => {
    // 如果录音还在继续，但识别结束了，可以重新启动识别
    if (isRecording.value) {
      speechRecognition.start();
    }
  };
  
  // 开始识别
  try {
    speechRecognition.start();
    console.log('开始语音识别...');
  } catch (error) {
    console.error('启动语音识别失败:', error);
  }
};

// 停止录音和语音识别
const stopRecording = async () => {
  // 更新状态
  isRecording.value = false;
  showRecordingModal.value = false;
  
  // 创建一个Promise来等待语音识别完成
  const waitForSpeechRecognition = new Promise((resolve) => {
    // 如果当前没有语音识别实例，直接返回当前结果
    if (!speechRecognition) {
      resolve(recognizedText.value);
      return;
    }
    
    // 保存当前结果，以防止丢失
    const currentText = recognizedText.value;
    
    // 创建一个onend回调来获取最终结果
    const originalOnEnd = speechRecognition.onend;
    
    speechRecognition.onend = () => {
      // 调用原始的onend处理器
      if (originalOnEnd) {
        originalOnEnd.call(speechRecognition);
      }
      
      // 给语音识别系统一点时间处理最后的结果
      setTimeout(() => {
        // 解析Promise，返回识别文本
        resolve(recognizedText.value || currentText);
      }, 500);
    };
    
    // 停止语音识别
    try {
      speechRecognition.stop();
      console.log('语音识别已停止，等待最终结果...');
    } catch (error) {
      console.error('停止语音识别时出错:', error);
      resolve(currentText); // 出错时使用当前文本
    }
  });
  
  // 停止波形动画
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  // 如果录音正在进行，停止它
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    // 停止录音前先修改onstop事件处理器，让它自动上传
    mediaRecorder.onstop = async () => {
      // 创建音频Blob
      audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
      
      // 释放之前的URL
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      
      // 创建本地URL用于预览
      audioUrl = URL.createObjectURL(audioBlob);
      
      // 创建音频元素
      if (!audioElement) {
        audioElement = new Audio();
      }
      audioElement.src = audioUrl;
      
      // 设置录音状态
      hasRecording.value = true;
      
      try {
        // 等待语音识别完成，获取最终文本
        const finalRecognizedText = await waitForSpeechRecognition;
        console.log('最终语音识别结果:', finalRecognizedText);
        
        // 生成文件路径和名称
        const filename = `recordings/${conversation_id}/${Date.now()}.wav`;
        
        // 上传到OSS
        const result = await ossStore.uploadFile(filename, audioBlob, {
          contentType: 'audio/wav',
          fileName: `recording_${Date.now()}.wav`,
          tags: { 
            type: 'user_recording', 
            conversation_id: conversation_id,
            // 避免使用中文标签值，防止OSS报错
            has_transcript: finalRecognizedText ? 'yes' : 'no',
            transcript_length: finalRecognizedText ? String(finalRecognizedText.length) : '0'
          }
        });
        
        if (result.success) {
          // 获取带签名的URL
          const ossUrl = ossStore.getSignedUrl(filename, 3600); // 1小时有效期
          console.log('录音上传成功，URL:', ossUrl);
          
          // 使用识别出的文本发送请求
          sendRequestToBackend(finalRecognizedText, ossUrl);
        } else {
          console.error('录音上传失败:', result.error);
        }
      } catch (error) {
        console.error('上传录音时发生错误:', error);
      }
    };
    
    // 停止录音
    mediaRecorder.stop();
    
    // 停止所有音轨
    if (mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  } else {
    // 如果没有正在进行的录音，仍然需要停止语音识别
    speechRecognition = null;
  }
  
  // 断开麦克风连接
  if (microphone) {
    microphone.disconnect();
  }
};

// 上传录音到OSS并获取URL
const uploadRecordingToOss = async () => {
  // 确保有录音数据
  if (!audioBlob) {
    console.error('没有可用的录音数据');
    return null;
  }
  
  try {
    // 生成文件路径和名称
    const filename = `recordings/${conversationId.value}/${Date.now()}.wav`;
    
    // 上传到OSS
    console.log('开始上传录音到OSS...');
    const result = await ossStore.uploadFile(filename, audioBlob, {
      contentType: 'audio/wav',
      fileName: `recording_${Date.now()}.wav`,
      tags: { 
        type: 'user_recording', 
        conversation_id: conversationId.value 
      }
    });
    
    if (result.success) {
      const audioUrl = ossStore.getSignedUrl(filename, 3600); // 1小时有效期
      console.log('录音上传成功, URL:', audioUrl);
      return audioUrl;
    } else {
      console.error('录音上传失败:', result.error);
      return null;
    }
  } catch (error) {
    console.error('上传录音时发生错误:', error);
    return null;
  }
};

// 播放录音
const playAudio = () => {
  if (audioElement && hasRecording.value) {
    audioElement.play();
  }
};

// 修改现有的cleanupAudio函数，添加对AudioContext的清理
const cleanupAudio = () => {
  stopRecording();

    // 清理语音识别
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch (e) {}
    speechRecognition = null;
  }
  
  if (microphone) {
    microphone.disconnect();
    microphone = null;
  }
  
  if (audioContext) {
    audioContext.close().catch(console.error);
    audioContext = null;
  }
  
  if (currentAudioContext) {
    currentAudioContext.close().catch(console.error);
    currentAudioContext = null;
  }
  
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  
  if (audioElement) {
    audioElement.src = '';
    audioElement = null;
  }
  
  analyser = null;
  dataArray = null;
  frequencyData = null;
  mediaRecorder = null;
  audioChunks = [];
  audioBlob = null;
  hasRecording.value = false;
  recognizedText.value = '';
};

// 窗口大小改变时重新初始化波形图
const handleResize = () => {
  if (showRecordingModal.value) {
    initWaveCanvas();
  }
};

window.addEventListener('resize', handleResize);

// 组件挂载时初始化
onMounted(async () => {
  try {
    const response = await fetch('/shizuku/runtime/shizuku.model3.json');
    if (!response.ok) {
      console.error('模型文件不存在! 状态:', response.status);
      return;
    }
  
    // 初始化Live2D模型
    await live2dStore.initLive2D(liveCanvas.value, '/shizuku/runtime/shizuku.model3.json');
    
    if (isModelLoaded.value) {
      console.log('Live2D模型加载成功!');
    }
  } catch (error) {
    console.error('加载模型时出错:', error);
  }
});

// 组件卸载前清理资源
onBeforeUnmount(() => {
  cleanupAudio();
  window.removeEventListener('resize', handleResize);
  live2dStore.cleanupCurrentModel();
});
</script>

<style scoped>
.talking-page {
  display: grid;
  grid-template-rows: 45fr 50fr 60px;
  height: 100vh;
  width: 100%;
  position: relative;
}

/* 桌面默认布局 - 使用比例布局 */
.live2d-section {
  grid-row: 1;
  position: relative;
  overflow: hidden;
}

.message-section {
  grid-row: 2;
  background-color: #fffef0; /* 米黄色基础背景，模拟纸张 */
  background-image: 
    /* 横线，模拟记事本的线条 */
    linear-gradient(#91a3b0 0.1em, transparent 0.1em);
  background-size: 
    100% 48px; /* 横线之间的间距 */
  background-position: 0 28px; /* 向下偏移28px，为顶部渐变区域留出空间 */
  border-left: 1px solid #d9d9d9;
  border-right: 1px solid #d9d9d9;
  border-bottom: 1px solid #d9d9d9;
  /* 移除原来的红色顶部边框 */
  /* border-top: 28px solid #e74c3c; */
  box-shadow: 
    0 1px 3px rgba(0,0,0,0.12), 
    0 1px 2px rgba(0,0,0,0.24),
    inset 0 0 15px rgba(0,0,0,0.05); /* 内阴影增加纸张质感 */
  padding: 15px; /* 均衡的内边距 */
  padding-top: 35px; /* 增加顶部内边距，为渐变区域留出空间 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* 添加渐变顶部条 */
.message-section::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 28px; /* 与原来的边框高度相同 */
  background-image: linear-gradient(135deg, #ff9900, #ff5500, #ff3366);
  z-index: 1; /* 确保在纸张纹理之上 */
}


/* 添加微妙的纸张纹理 */
.message-section::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: url('data:image/png;base64,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');
  opacity: 0.07;
  pointer-events: none;
  z-index: 0;
}

/* 消息容器样式修改 */
.message-map {
  flex: 1;
  overflow-y: auto; 
  height: 100%;
  padding: 0;
  position: relative;
  z-index: 2;
}

.speak-control {
  grid-row: 3;
  background-color: #ffffff;
  border-top: 1px solid #e0e0e0;
}

.speak-control-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #fffef0; /* 米黄色基础背景，模拟纸张 */
}

.button-group {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
  align-items: center;
}

/* 按钮基本样式 */
.control-button {
  height: 40px;
}

/* 录音按钮特有样式 */
.record-button {
  flex: 8;
  max-width: 70%;
}

/* 播放按钮特有样式 - 调整为更小尺寸 */
.play-button {
  flex: none;
  width: 40px !important;
  height: 40px !important;
  border-radius: 50%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #1890ff;
  color: white;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.16);
  transition: all 0.3s;
}

/* 播放按钮悬停效果 */
.play-button:not(:disabled):hover {
  transform: scale(1.1);
  box-shadow: 0 5px 10px rgba(0, 0, 0, 0.2);
}

/* 播放按钮禁用样式 */
.play-button:disabled {
  background-color: #cccccc !important;
  opacity: 0.7;
}

/* 播放按钮图标调整 */
.play-button :deep(.el-icon) {
  font-size: 18px;
  margin: 0;
}

/* 渐变按钮样式 */
.gradient-button {
  background-image: linear-gradient(135deg, #ff9900, #ff5500, #ff3366) !important;
  border: none !important;
  transition: all 0.3s ease;
  box-shadow: 0 3px 15px rgba(255, 153, 0, 0.3);
  position: relative;
  overflow: hidden;
}

/* 悬停效果 */
.gradient-button:hover {
  background-image: linear-gradient(135deg, #ffaa00, #ff6600, #ff4477) !important;
  box-shadow: 0 5px 20px rgba(255, 153, 0, 0.5);
  transform: translateY(-2px);
}

/* 点击效果 */
.gradient-button:active {
  transform: translateY(1px);
  box-shadow: 0 2px 10px rgba(255, 153, 0, 0.2);
}

/* 添加光泽效果 */
.gradient-button::before {
  content: "";
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: linear-gradient(
    to bottom right,
    rgba(255, 255, 255, 0.3) 0%,
    rgba(255, 255, 255, 0) 60%
  );
  transform: rotate(30deg);
  pointer-events: none;
  z-index: 1;
  transition: all 0.6s ease;
}

.gradient-button:hover::before {
  transform: rotate(30deg) translate(10%, 10%);
}

/* 确保文字在上层且居中 */
:deep(.gradient-button span) {
  position: relative;
  z-index: 2;
}

/* 更新声纹容器样式 */
.voice-wave-container {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  background: transparent;
  padding: 0;
  margin: 0;
  box-shadow: none;
  border: none;
}

/* 添加一个中心线，更像录音界面 */
.voice-wave-container::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background-color: rgba(255, 255, 255, 0.3);
  z-index: 1;
}

.voice-wave-canvas {
  width: 100%;
  height: 100%;
  display: block;
  filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.5));
}

/* 自定义Element Plus对话框样式 */
:deep(.recording-dialog) {
  border-radius: 20px 20px 0 0;
  overflow: hidden;
  box-shadow: 0 -5px 25px rgba(165, 43, 43, 0.15);
  padding: 0 !important;
  background: transparent;
}

:deep(.el-dialog__header) {
  margin: 0;
  padding: 20px;
  background-image: linear-gradient(135deg, #ff9900, #ff5500, #ff3366);
  text-align: center;
  border-radius: 20px 20px 0 0;
  width: 100%;
  box-sizing: border-box;
}

:deep(.el-dialog__title) {
  color: white;
  font-size: 20px;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

:deep(.el-dialog__headerbtn) {
  top: 20px;
  right: 20px;
}

:deep(.el-dialog__headerbtn .el-dialog__close) {
  color: rgba(255, 255, 255, 0.9);
  font-size: 22px;
}

:deep(.el-dialog__headerbtn:hover .el-dialog__close) {
  color: white;
}

:deep(.el-dialog__body) {
  padding: 0 !important;
  margin: 0 !important;
  background-color: transparent;
  height: calc(100% - 60px);
  position: relative;
}

/* 使对话框从底部弹出且占满整个宽度 */
:deep(.el-overlay) {
  overflow: hidden;
}

:deep(.el-dialog) {
  margin: 0 !important;
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  width: 100% !important;
  max-width: 100%;
  transform: none !important;
  border-radius: 20px 20px 0 0 !important;
  max-height: 45vh;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  /* 渐变背景替换透明背景 */
  /* 替换现有背景，添加透明度 */
  background-image: linear-gradient(135deg, 
                  rgba(255, 153, 0, 0.9), 
                  rgba(255, 85, 0, 0.9), 
                  rgba(255, 51, 102, 0.9)) !important;
  
  /* 增加模糊效果增强视觉层次感 */
  backdrop-filter: blur(10px);
  padding: 0 !important;
}

/* 对话框动画 */
:deep(.el-overlay) {
  animation: fadeIn 0.3s ease;
}

:deep(.el-dialog) {
  animation: slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(100%) !important; }
  to { transform: translateY(0) !important; }
}

.controls-container {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.live2d-canvas {
  width: 100%;
  height: 100%;
  z-index: 1;
  position: relative;
}

.live2d-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.live2d-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* 背景图片路径，使用你的学校背景 */
  background-image: url('/background/classroom.png');
  /* 或者如果你知道确切路径 */
  /* background-image: url('/shizuku/runtime/backgrounds/school.png'); */
  background-size: cover;
  background-position: center;
  z-index: 0;
}

@media (max-width: 600px) {
  .live2d-section {
    flex: 8;
  }
  
  .message-section {
    flex: 10.5;
  }
  
  .speak-control {
    flex: 0 0 75px;
  }
  
  .button-group {
    gap: 10px;
  }
  
  .control-button {
    height: 36px;
    font-size: 14px;
  }
  
  .record-button {
    flex: 5;
    max-width: 75%;
  }
  
  .play-button {
    width: 36px !important;
    height: 36px !important;
  }
  
  :deep(.el-dialog) {
    max-height: 60vh; /* 移动端占更多高度 */
    min-height: 250px;
  }
  
  :deep(.el-dialog__title) {
    font-size: 18px;
  }
}
</style>

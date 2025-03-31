<template>
  <div class="talking-page">
    <div class="live2d-section">
      <div class="live2d-container">
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
            @click="sendRequestToBackend"
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
import { storeToRefs } from 'pinia';
import { ElButton, ElDialog, ElText, ElIcon } from 'element-plus';
import { VideoPlay } from '@element-plus/icons-vue';
import MessageMap from 'src/components/MessageMap.vue';
import 'element-plus/dist/index.css';

// 使用Pinia Store
const live2dStore = useLive2DStore();

// 使用storeToRefs获取响应式状态
const { model, isModelLoaded } = storeToRefs(live2dStore);

// 引用canvas元素
const liveCanvas = ref(null);
const waveCanvas = ref(null);
const isRecording = ref(false);
const showRecordingModal = ref(false);
const hasRecording = ref(false);

const messages = ref([
  { type: 'ai', content: '你好，我是AI助手，有什么我可以帮你的？', timestamp: Date.now() }
]);

// 示例：添加新消息的方法（在实际应用中，这将由您的发送消息逻辑调用）
const addMessage = (type, content) => {
  messages.value.push({
    type,
    content,
    timestamp: Date.now()
  });
};

const isLoading = ref(false);

const sendRequestToBackend = async () => {
  try {
    isLoading.value = true;
    
    // 创建一个用户消息
    messages.value.push({
      type: 'user',
      content: '请分析这段音频在说什么',
      timestamp: Date.now()
    });
    
    // 创建请求体
    const requestBody = {
      "conversation_id": "conv_test",
      "content": [
        {
          "type": "input_audio",
          "input_audio": {
            "data": "https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3",
            "format": "mp3"
          }
        },
        {
          "type": "text", 
          "text": "这段音频在说什么"
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

const playBase64AudioDirectly = (base64Data) => {
  // 检查base64数据是否有效
  if (!base64Data || typeof base64Data !== 'string') {
    console.error('无效的base64数据');
    return;
  }
  
  try {
    // 确保audioContext存在
    if (!currentAudioContext) {
      try {
        currentAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.error('创建AudioContext失败:', e);
        return;
      }
    }
    
    // 直接从base64创建ArrayBuffer (不需要使用atob)
    let binary = '';
    const bytes = new Uint8Array(base64Data.length);
    let arrayBuffer;
    
    try {
      // 方法1: 使用Base64 API (较新的浏览器支持)
      if (window.atob) {
        try {
          // 修复base64填充字符
          while (base64Data.length % 4 !== 0) {
            base64Data += '=';
          }
          
          // 解码base64
          binary = atob(base64Data);
          arrayBuffer = new ArrayBuffer(binary.length);
          const bytes = new Uint8Array(arrayBuffer);
          
          // 填充arrayBuffer
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
        } catch (e) {
          console.error('Base64解码失败:', e);
        }
      }
    } catch (e) {
      console.error('Base64解码尝试失败:', e);
      return;
    }
    
    // 打印音频信息，方便调试
    console.log('音频数据大小:', arrayBuffer.byteLength, '字节');
    
    // 检查WAV头信息
    if (arrayBuffer.byteLength > 44) { // WAV头至少44字节
      const headerView = new DataView(arrayBuffer, 0, 44);
      // 检查RIFF和WAVE标识
      const riff = String.fromCharCode(
        headerView.getUint8(0), headerView.getUint8(1),
        headerView.getUint8(2), headerView.getUint8(3)
      );
      const wave = String.fromCharCode(
        headerView.getUint8(8), headerView.getUint8(9),
        headerView.getUint8(10), headerView.getUint8(11)
      );
      
      console.log('文件标识:', riff, wave);
      console.log('采样率:', headerView.getUint32(24, true));
      console.log('声道数:', headerView.getUint16(22, true));
      console.log('位深度:', headerView.getUint16(34, true));
    } else {
      console.warn('音频数据太短，不像是有效的WAV文件');
    }
    
    // 解码音频数据
    currentAudioContext.decodeAudioData(
      arrayBuffer, 
      (buffer) => {
        console.log('音频解码成功:', buffer.duration, '秒');
        // 创建音频源
        const source = currentAudioContext.createBufferSource();
        source.buffer = buffer;
        
        // 连接到音频输出
        source.connect(currentAudioContext.destination);
        
        // 开始播放
        source.start(0);
        
        // 可选：如果有Live2D模型，可以触发说话动画
        if (model.value) {
          // 尝试触发Live2D模型说话动画
          try {
            if (typeof model.value.motion === 'function') {
              // 随机选择一个动作组
              const motionGroups = ['idle', 'tap_body', 'pinch_in', 'flick_head'];
              const groupName = motionGroups[Math.floor(Math.random() * motionGroups.length)];
              model.value.motion(groupName);
            }
          } catch (err) {
            console.error('触发Live2D动作失败:', err);
          }
        }
      }, 
      (err) => {
        console.error('解码音频失败:', err);
        
        // 尝试直接创建和播放音频元素(备用方案)
        try {
          const audio = new Audio(`data:audio/wav;base64,${base64Data}`);
          audio.play().catch(e => console.error('直接播放音频失败:', e));
        } catch (e) {
          console.error('备用方案播放音频失败:', e);
        }
      }
    );
  } catch (error) {
    console.error('播放音频处理失败:', error);
  }
};

// 音频相关变量
let audioContext = null;
let analyser = null;
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

// 开始录音
const startRecording = async () => {
  isRecording.value = true;
  
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
    
    mediaRecorder.start();
    
    // 开始绘制波浪动画
    drawWave();
    
  } catch (error) {
    console.error('获取麦克风权限失败:', error);
    isRecording.value = false;
    showRecordingModal.value = false;
  }
};

// 停止录音
const stopRecording = () => {
  isRecording.value = false;
  showRecordingModal.value = false;
  
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
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
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  position: relative;
}

/* 桌面默认布局 - 使用比例布局 */
.live2d-section {
  flex: 4.5;
  position: relative;
  overflow: hidden;
}

.message-section {
  flex: 5;
  background-color: #ffffff;
  border-top: 1px solid #e0e0e0;
  padding: 12px;
}

.speak-control {
  flex: 0 0 60px;
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
}

.live2d-container {
  width: 100%;
  height: 100%;
  position: relative;
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
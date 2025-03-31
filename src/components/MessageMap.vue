<template>
    <div class="message-map">
      <div 
        v-for="(message, index) in messages" 
        :key="index" 
        :class="['message-container', message.type === 'user' ? 'user-message' : 'ai-message']"
      >
        <div class="message-content">
          <div class="message-text">{{ message.content }}</div>
          <div class="message-time">{{ formatTime(message.timestamp) }}</div>
        </div>
      </div>
      <div ref="bottomEl" class="message-bottom"></div>
    </div>
  </template>
  
  <script setup>
  import { ref, watch, nextTick, onMounted, defineProps, defineExpose } from 'vue';
  
  const props = defineProps({
    messages: {
      type: Array,
      default: () => [],
    }
  });
  
  const bottomEl = ref(null);
  
  // 格式化时间的函数
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };
  
  // 滚动到底部的函数
  const scrollToBottom = () => {
    if (bottomEl.value) {
      bottomEl.value.scrollIntoView({ behavior: 'smooth' });
    }
  };
  
  // 监听消息列表变化，自动滚动到底部
  watch(() => props.messages, () => {
    nextTick(() => {
      scrollToBottom();
    });
  }, { deep: true });
  
  // 在组件挂载时滚动到底部
  onMounted(() => {
    scrollToBottom();
  });
  </script>
  
  <style scoped>
  .message-map {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    height: 100%;
    overflow-y: auto;
  }
  
  .message-container {
    display: flex;
    width: 100%;
  }
  
  .user-message {
    justify-content: flex-start;
  }
  
  .ai-message {
    justify-content: flex-end;
  }
  
  .message-content {
    max-width: 70%;
    padding: 12px 16px;
    border-radius: 12px;
    position: relative;
  }
  
  .user-message .message-content {
    background-color: #f0f0f0;
    border-bottom-left-radius: 4px;
  }
  
  .ai-message .message-content {
    background-color: #e1f5fe;
    border-bottom-right-radius: 4px;
    text-align: right;
  }
  
  .message-sender {
    font-size: 0.8rem;
    font-weight: bold;
    margin-bottom: 4px;
    color: #555;
  }
  
  .message-text {
    word-break: break-word;
    white-space: pre-wrap;
    line-height: 1.4;
  }
  
  .message-time {
    font-size: 0.7rem;
    color: #888;
    margin-top: 4px;
  }
  
  .message-bottom {
    height: 1px;
  }
  </style>
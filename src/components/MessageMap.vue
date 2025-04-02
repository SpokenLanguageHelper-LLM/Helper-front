<template>
    <div class="message-map">
      <div 
        v-for="(message, index) in messages" 
        :key="index" 
        :class="['message-container', message.type === 'user' ? 'user-message' : 'ai-message']"
      >
        <div class="message-content">
          <div class="message-text">
            <Bubble class="bubble-container" typing :content="message.content" :loading="loading">
              
              <template #footer>
                <div class="footer-container">
                  <el-button type="info" :icon="Refresh" size="small" circle />
                  <el-text> {{ formatTime(message.timestamp) }} </el-text>
                  <!-- <el-button type="success" :icon="Search" size="small" circle />
                  <el-button type="warning" :icon="Star" size="small" circle />
                  <el-button color="#626aef" :icon="DocumentCopy" size="small" circle /> -->
                </div>
              </template>
            </Bubble>
          </div>
          <!-- <div class="message-time">{{ formatTime(message.timestamp) }}</div> -->
        </div>
      </div>
      <!-- <div ref="bottomEl" class="message-bottom"></div> -->
    </div>
  </template>
  
  <script setup>
  import { ref, watch, nextTick, onMounted, defineProps } from 'vue';
  import { Bubble } from 'vue-element-plus-x';
  import { ElButton, ElText, } from 'element-plus';
  import { Refresh } from '@element-plus/icons-vue'
  import 'element-plus/dist/index.css';
  
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
    justify-content: flex-end;
  }
  
  .ai-message {
    justify-content: flex-start;
  }
  
  .message-content {
    max-width: 80%;
    padding: 0px;
    border-radius: 12px;
    position: relative;
  }
  
  .user-message .message-content {
    /* background-color: #f0f0f0; */
    border-bottom-left-radius: 4px;
  }
  
  .ai-message .message-content {
    /* background-color: #e1f5fe; */
    border-bottom-right-radius: 4px;
    /* text-align: right; */
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

  .bubble-container {
    background-color: transparent;
    border-radius: 12px;
    position: relative;
    max-width: 100%;
    overflow-wrap: break-word;
    font-family:'Lucida Sans', 'Lucida Sans Regular', 'Lucida Grande', 'Lucida Sans Unicode', Geneva, Verdana, sans-serif;
    font-weight: bold;
  }
</style>

<style scoped lang="less">
  .footer-container {
    :deep(.el-button+.el-button) {
      margin-left: 8px;
    }
    :deep(.el-text) {
    margin-left: 8px;
    }
  }
  :deep(.el-bubble-content-wrapper .el-bubble-content-filled) {
    background: linear-gradient(to right, #fdfcfb 0%, #ffd1ab 100%) !important;
  }
</style>

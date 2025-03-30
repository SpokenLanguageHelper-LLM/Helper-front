import { defineStore } from 'pinia';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import '../../public/live2dcubismcore.min.js';

// 确保pixi-live2d-display能正常工作
window.PIXI = PIXI;

export const useLive2DStore = defineStore('live2d', {
  state: () => ({
    app: null,
    model: null,
    isModelLoaded: false,
    currentCanvas: null
  }),
  
  actions: {
    async initLive2D(canvasElement, modelPath) {
      this.cleanupCurrentModel();
      
      if (!canvasElement) return;
      this.currentCanvas = canvasElement;
      
      // 创建PIXI应用
      this.app = new PIXI.Application({
        view: canvasElement,
        autoStart: true,
        backgroundAlpha: 0, // 设置为轻微可见以便调试
        width: canvasElement.clientWidth, // 确保尺寸正确
        height: canvasElement.clientHeight,
        resizeTo: canvasElement.parentElement // 跟随父元素大小
      });

      try {
        // 加载Live2D模型
        this.model = await Live2DModel.from(modelPath);
        this.app.stage.addChild(this.model);
                // 设置模型锚点为中心，确保居中
        if (this.model.anchor) {
          this.model.anchor.set(0.5);
        }
        // 调整这些值让模型可见
        this.model.scale.set(0.25); // 增加缩放比例
        this.model.x = this.app.renderer.width / 2;
        this.model.y = this.app.renderer.height / 2;
                // 设置模型锚点为中心，确保居中
        if (this.model.anchor) {
          this.model.anchor.set(0.5);
        }
        this.isModelLoaded = true;
        window.addEventListener('resize', this.handleResize.bind(this));
      } catch (error) {
        console.error('加载Live2D模型失败:', error);
      }
    },
    
    // 添加handleResize方法
    handleResize() {
      if (this.model && this.app) {
        // 窗口大小改变时重新居中模型
        this.model.x = this.app.renderer.width / 2;
        this.model.y = this.app.renderer.height / 2;
      }
    },

    cleanupCurrentModel() {
      if (this.model) {
        this.model.destroy();
        this.model = null;
      }
      
      if (this.app) {
        this.app.destroy();
        this.app = null;
      }
      
      this.isModelLoaded = false;
      this.currentCanvas = null;
    }
  }
});
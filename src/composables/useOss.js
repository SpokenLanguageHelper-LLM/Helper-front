import { defineStore } from 'pinia';
import OSS from 'ali-oss';

/**
 * OSS 服务 Store
 */
export const useOssStore = defineStore('oss', {
  state: () => ({
    client: null,
    initialized: false,
    uploading: false,
    downloading: false,
    lastError: null,
    lastOperation: null,
    config: {
      region: '',
      accessKeyId: '',
      accessKeySecret: '',
      bucket: '',
      secure: true,
      timeout: 60000,
    }
  }),
  
  actions: {
    /**
     * 初始化 OSS 客户端
     * @param {Object} config OSS配置
     * @returns {Boolean} 是否初始化成功
     */
    initialize(config = {}) {
      try {
        // 合并配置
        this.config = {
          ...this.config,
          ...config
        };
        
        // 检查必要参数
        if (!this.config.region || !this.config.bucket) {
          throw new Error('OSS初始化失败：region和bucket为必填项');
        }
        
        // 优先使用参数中的访问凭证，其次使用环境变量
        const accessKeyId = this.config.accessKeyId || process.env.OSS_ACCESS_KEY_ID;
        const accessKeySecret = this.config.accessKeySecret || process.env.OSS_ACCESS_KEY_SECRET;
        
        if (!accessKeyId || !accessKeySecret) {
          throw new Error('OSS初始化失败：未提供访问凭证');
        }
        
        // 创建OSS客户端
        this.client = new OSS({
          region: this.config.region,
          accessKeyId,
          accessKeySecret,
          bucket: this.config.bucket,
          secure: this.config.secure,
          timeout: this.config.timeout,
        });
        
        // 更新状态
        this.initialized = true;
        this.lastError = null;
        
        console.log('OSS客户端初始化成功');
        return true;
      } catch (error) {
        console.error('OSS客户端初始化失败:', error);
        this.lastError = error;
        this.initialized = false;
        return false;
      }
    },
    
    /**
     * 上传文件
     * @param {String} ossPath OSS上的文件路径
     * @param {File|Blob|String|Buffer} file 文件数据
     * @param {Object} options 上传选项
     * @returns {Promise<Object>} 上传结果
     */
    async uploadFile(ossPath, file, options = {}) {
      if (!this.ensureInitialized()) {
        return { success: false, error: '客户端未初始化' };
      }
      
      this.uploading = true;
      this.lastOperation = `上传文件: ${ossPath}`;
      
      try {
        // 合并默认选项和用户选项
        const uploadOptions = {
          headers: {
            'x-oss-storage-class': options.storageClass || 'Standard',
            'x-oss-object-acl': options.acl || 'private',
          },
          ...options
        };
        
        // 处理Content-Type
        if (options.contentType) {
          uploadOptions.headers['Content-Type'] = options.contentType;
        }
        
        // 处理文件下载名称
        if (options.fileName) {
          uploadOptions.headers['Content-Disposition'] = 
            `attachment; filename="${encodeURIComponent(options.fileName)}"`;
        }
        
        // 处理标签
        if (options.tags && Object.keys(options.tags).length > 0) {
          const tagString = Object.entries(options.tags)
            .map(([key, value]) => `${key}=${value}`)
            .join('&');
          uploadOptions.headers['x-oss-tagging'] = tagString;
        }
        
        // 是否禁止覆盖同名文件
        if (options.forbidOverwrite) {
          uploadOptions.headers['x-oss-forbid-overwrite'] = 'true';
        }
        
        // 使用进度回调
        if (typeof options.onProgress === 'function') {
          uploadOptions.progress = (p, checkpoint) => {
            options.onProgress(p * 100, checkpoint);
          };
        }
        
        console.log(`开始上传文件到OSS: ${ossPath}`);
        const result = await this.client.put(ossPath, file, uploadOptions);
        console.log(`文件上传成功: ${ossPath}`);
        
        this.lastError = null;
        
        return {
          success: true,
          url: result.url,
          name: ossPath,
          ...result
        };
      } catch (error) {
        console.error(`文件上传失败 ${ossPath}:`, error);
        this.lastError = error;
        
        return {
          success: false,
          error: error.message || '上传失败',
          ossPath
        };
      } finally {
        this.uploading = false;
      }
    },
    
    /**
     * 获取文件签名URL
     * @param {String} ossPath 文件路径
     * @param {Number} expires URL有效期（秒）
     * @param {Object} options 签名选项
     * @returns {String} 签名URL
     */
    getSignedUrl(ossPath, expires = 3600, options = {}) {
      if (!this.ensureInitialized()) {
        return null;
      }
      
      try {
        const signOptions = {
          expires,
          ...options
        };
        
        const url = this.client.signatureUrl(ossPath, signOptions);
        return url;
      } catch (error) {
        console.error(`获取签名URL失败 ${ossPath}:`, error);
        this.lastError = error;
        return null;
      }
    },
    
    /**
     * 下载文件
     * @param {String} ossPath 文件路径
     * @param {String} localPath 本地保存路径（浏览器环境下可选）
     * @returns {Promise<Object>} 下载结果
     */
    async downloadFile(ossPath, localPath) {
      if (!this.ensureInitialized()) {
        return { success: false, error: '客户端未初始化' };
      }
      
      this.downloading = true;
      this.lastOperation = `下载文件: ${ossPath}`;
      
      try {
        console.log(`开始下载文件: ${ossPath}`);
        const result = await this.client.get(ossPath, localPath);
        console.log(`文件下载成功: ${ossPath}`);
        
        this.lastError = null;
        
        return {
          success: true,
          content: result.content,
          ossPath
        };
      } catch (error) {
        console.error(`文件下载失败 ${ossPath}:`, error);
        this.lastError = error;
        
        return {
          success: false,
          error: error.message || '下载失败',
          ossPath
        };
      } finally {
        this.downloading = false;
      }
    },
    
    /**
     * 删除文件
     * @param {String} ossPath 文件路径
     * @returns {Promise<Object>} 删除结果
     */
    async deleteFile(ossPath) {
      if (!this.ensureInitialized()) {
        return { success: false, error: '客户端未初始化' };
      }
      
      this.lastOperation = `删除文件: ${ossPath}`;
      
      try {
        console.log(`开始删除文件: ${ossPath}`);
        const result = await this.client.delete(ossPath);
        console.log(`文件删除成功: ${ossPath}`);
        
        this.lastError = null;
        
        return {
          success: true,
          ossPath,
          ...result
        };
      } catch (error) {
        console.error(`文件删除失败 ${ossPath}:`, error);
        this.lastError = error;
        
        return {
          success: false,
          error: error.message || '删除失败',
          ossPath
        };
      }
    },
    
    /**
     * 检查文件是否存在
     * @param {String} ossPath 文件路径
     * @returns {Promise<Boolean>} 文件是否存在
     */
    async isFileExist(ossPath) {
      if (!this.ensureInitialized()) {
        return false;
      }
      
      try {
        const result = await this.client.head(ossPath);
        return result.status === 200;
      } catch (error) {
        if (error.code === 'NoSuchKey') {
          return false;
        }
        console.error(`检查文件是否存在失败 ${ossPath}:`, error);
        this.lastError = error;
        return false;
      }
    },
    
    /**
     * 获取文件列表
     * @param {Object} options 列表选项
     * @returns {Promise<Object>} 文件列表
     */
    async listFiles(options = {}) {
      if (!this.ensureInitialized()) {
        return { success: false, error: '客户端未初始化', files: [] };
      }
      
      this.lastOperation = '获取文件列表';
      
      try {
        const listOptions = {
          prefix: options.prefix || '',
          marker: options.marker || '',
          'max-keys': options.maxKeys || 100,
          delimiter: options.delimiter || ''
        };
        
        console.log(`开始获取文件列表: ${JSON.stringify(listOptions)}`);
        const result = await this.client.list(listOptions);
        
        this.lastError = null;
        
        return {
          success: true,
          files: result.objects || [],
          prefixes: result.prefixes || [],
          nextMarker: result.nextMarker,
          isTruncated: result.isTruncated
        };
      } catch (error) {
        console.error('获取文件列表失败:', error);
        this.lastError = error;
        
        return {
          success: false,
          error: error.message || '获取列表失败',
          files: []
        };
      }
    },
    
    /**
     * 复制文件
     * @param {String} source 源文件路径
     * @param {String} target 目标文件路径
     * @param {Object} options 复制选项
     * @returns {Promise<Object>} 复制结果
     */
    async copyFile(source, target, options = {}) {
      if (!this.ensureInitialized()) {
        return { success: false, error: '客户端未初始化' };
      }
      
      this.lastOperation = `复制文件: ${source} -> ${target}`;
      
      try {
        console.log(`开始复制文件: ${source} -> ${target}`);
        const result = await this.client.copy(target, source, options);
        console.log(`文件复制成功: ${source} -> ${target}`);
        
        this.lastError = null;
        
        return {
          success: true,
          source,
          target,
          ...result
        };
      } catch (error) {
        console.error(`文件复制失败 ${source} -> ${target}:`, error);
        this.lastError = error;
        
        return {
          success: false,
          error: error.message || '复制失败',
          source,
          target
        };
      }
    },

    
    
    /**
     * 确保客户端已初始化
     * @returns {Boolean} 客户端是否已初始化
     */
    ensureInitialized() {
      if (!this.client || !this.initialized) {
        console.error('OSS客户端未初始化');
        return false;
      }
      return true;
    },
    
    /**
     * 清理资源
     */
    cleanup() {
      this.client = null;
      this.initialized = false;
      this.uploading = false;
      this.downloading = false;
      this.lastError = null;
      this.lastOperation = null;
    }
  }
});
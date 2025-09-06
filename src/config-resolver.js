#!/usr/bin/env node

/**
 * Content Configuration Resolver - 简化而稳健的文件路径解析
 * 
 * 优先级: initialize() > CLI > ENV > config > 智能发现
 */

import fs from 'fs';
import path from 'path';

export default class ContentResolver {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.defaultContentDir = path.join(projectRoot, 'docx2json');
  }
  
  /**
   * 解析内容文件路径
   * @param {Object} options - 配置选项
   * @param {string} options.initParam - 来自initialize()参数
   * @param {string} options.cliArg - CLI --content参数
   * @param {string} options.envVar - CONTENT_JSON_PATH环境变量
   * @param {string} options.configOverride - 可选的配置文件路径
   * @returns {Object} { contentPath, source }
   */
  resolve(options = {}) {
    const {
      initParam,
      cliArg,
      envVar,
      configOverride
    } = options;
    
    // 简化的优先级链
    const candidates = [
      { path: initParam, source: 'initialize()' },
      { path: cliArg, source: 'CLI --content' },
      { path: envVar, source: 'ENV CONTENT_JSON_PATH' },
      { path: this.getFromConfig(configOverride), source: 'server-config.json' },
      { path: this.autoDiscover(), source: 'auto-discovery' }
    ].filter(c => c.path);
    
    for (const candidate of candidates) {
      const resolved = this.resolvePath(candidate.path);
      if (this.validatePath(resolved)) {
        console.log(`📄 Using content: ${resolved} (via ${candidate.source})`);
        return { contentPath: resolved, source: candidate.source };
      }
    }
    
    throw new Error(`No valid content file found. Tried: ${
      candidates.map(c => `${c.source}: ${c.path}`).join(', ')
    }`);
  }
  
  /**
   * 将输入路径解析为绝对路径
   */
  resolvePath(pathInput) {
    if (!pathInput) return null;
    return path.isAbsolute(pathInput) 
      ? pathInput 
      : path.join(this.defaultContentDir, pathInput);
  }
  
  /**
   * 验证文件路径是否有效且包含正确格式的JSON
   */
  validatePath(filePath) {
    if (!filePath) return false;
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(content);
      
      // 基本结构检查：必须有blocks数组
      return json.blocks && Array.isArray(json.blocks);
    } catch {
      return false;
    }
  }
  
  /**
   * 从配置文件读取内容文件名
   */
  getFromConfig(configPath) {
    try {
      const configFile = configPath || path.join(this.projectRoot, 'config/server-config.json');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      return config.workflow?.current_content_file;
    } catch {
      return null;
    }
  }
  
  /**
   * 智能发现内容文件
   * 按文件修改时间和名称模式，选择最合适的内容文件
   */
  autoDiscover() {
    try {
      const files = fs.readdirSync(this.defaultContentDir)
        .filter(f => f.endsWith('.json') && 
                    !f.includes('config') && 
                    !f.includes('mapping') &&
                    !f.includes('state'))
        .map(f => {
          const fullPath = path.join(this.defaultContentDir, f);
          const stat = fs.statSync(fullPath);
          return { name: f, mtime: stat.mtime };
        })
        .sort((a, b) => b.mtime - a.mtime); // 按修改时间降序
      
      if (files.length === 0) return null;
      
      // 策略1: 如果只有一个文件，直接返回
      if (files.length === 1) return files[0].name;
      
      // 策略2: 优先选择最新修改的日期格式文件
      const dateFiles = files.filter(f => f.name.match(/^\d{6}.*\.json$/));
      if (dateFiles.length > 0) {
        // 如果修改时间相同，按日期字符串降序选择（更新的日期）
        const sortedByDate = dateFiles.sort((a, b) => {
          const dateA = a.name.substring(0, 6);
          const dateB = b.name.substring(0, 6);
          return dateB.localeCompare(dateA); // 降序，更新日期在前
        });
        console.log(`🔍 Auto-discovery: Found ${dateFiles.length} date-pattern files, choosing latest date: ${sortedByDate[0].name}`);
        return sortedByDate[0].name;
      }
      
      // 策略3: 返回最新修改的文件
      console.log(`🔍 Auto-discovery: No date-pattern files, choosing latest modified: ${files[0].name}`);
      return files[0].name;
    } catch {
      return null;
    }
  }
}

/**
 * 简单的CLI参数解析器
 */
export function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      parsed[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      if (parsed[key] !== true) i++; // 跳过值
    }
  }
  
  return parsed;
}

// 便捷导出函数
export function resolveContentPath(projectRoot, options = {}) {
  const resolver = new ContentResolver(projectRoot);
  return resolver.resolve(options);
}
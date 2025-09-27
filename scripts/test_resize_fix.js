#!/usr/bin/env node

/**
 * 测试海报高度自适应修复
 * 用于验证 resizePosterToFit 功能是否正常工作
 */

const WebSocket = require('ws');
const readline = require('readline');

class ResizeTestClient {
  constructor(port = 3055) {
    this.wsUrl = `ws://localhost:${port}`;
    this.ws = null;
    this.isConnected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      console.log(`🔌 连接到插件服务器: ${this.wsUrl}`);

      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log('✅ WebSocket 连接成功');
        this.isConnected = true;
        resolve();
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket 连接错误:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 WebSocket 连接已关闭');
        this.isConnected = false;
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          console.log('📨 收到消息:', JSON.stringify(message, null, 2));
        } catch (error) {
          console.log('📨 收到原始消息:', data.toString());
        }
      });
    });
  }

  async sendCommand(command, params = {}) {
    if (!this.isConnected) {
      throw new Error('WebSocket 未连接');
    }

    return new Promise((resolve, reject) => {
      const message = { command, params };
      console.log(`📤 发送命令: ${command}`, params);

      const messageHandler = (data) => {
        try {
          const response = JSON.parse(data);
          this.ws.removeListener('message', messageHandler);

          if (response.error) {
            console.error(`❌ 命令失败: ${response.error}`);
            reject(new Error(response.error));
          } else {
            console.log(`✅ 命令成功:`, response.result || response);
            resolve(response.result || response);
          }
        } catch (error) {
          console.error('解析响应失败:', error);
          reject(error);
        }
      };

      this.ws.once('message', messageHandler);
      this.ws.send(JSON.stringify(message));

      // 超时处理
      setTimeout(() => {
        this.ws.removeListener('message', messageHandler);
        reject(new Error('命令超时'));
      }, 10000);
    });
  }

  async testResizePosterToFit() {
    console.log('\n🧪 测试 resizePosterToFit 功能\n');
    console.log('请在 Figma 中选择一个海报 Frame，然后按回车继续...');

    await this.waitForEnter();

    // 获取当前选择
    console.log('\n1️⃣ 获取当前选择的节点...');
    const selection = await this.sendCommand('get_selection');

    if (!selection || selection.length === 0) {
      console.error('❌ 请先在 Figma 中选择一个海报 Frame');
      return;
    }

    const posterId = selection[0].id;
    const posterName = selection[0].name;
    console.log(`✅ 选中的海报: "${posterName}" (ID: ${posterId})`);

    // 测试不同的场景
    console.log('\n2️⃣ 测试场景 1: 自动查找锚点（不指定 anchorId）');
    try {
      const result1 = await this.sendCommand('resize_poster_to_fit', {
        posterId: posterId,
        bottomPadding: 200
      });
      console.log('✅ 场景 1 成功:', result1);
    } catch (error) {
      console.error('❌ 场景 1 失败:', error.message);
    }

    await this.sleep(2000);

    // 测试指定锚点的情况
    console.log('\n3️⃣ 测试场景 2: 查找 ContentAndPlate 作为锚点');
    try {
      // 先获取海报的子节点
      const nodeInfo = await this.sendCommand('get_node_info', { nodeId: posterId });
      let anchorId = null;

      if (nodeInfo.children) {
        for (const child of nodeInfo.children) {
          if (child.name && child.name.toLowerCase().includes('contentandplate')) {
            anchorId = child.id;
            console.log(`✅ 找到锚点: "${child.name}" (ID: ${anchorId})`);
            break;
          }
        }
      }

      if (anchorId) {
        const result2 = await this.sendCommand('resize_poster_to_fit', {
          posterId: posterId,
          anchorId: anchorId,
          bottomPadding: 150
        });
        console.log('✅ 场景 2 成功:', result2);
      } else {
        console.log('⚠️ 未找到 ContentAndPlate 锚点，跳过场景 2');
      }
    } catch (error) {
      console.error('❌ 场景 2 失败:', error.message);
    }

    await this.sleep(2000);

    // 测试短图场景
    console.log('\n4️⃣ 测试场景 3: 查找 shortCard 作为锚点（短图场景）');
    try {
      const nodeInfo = await this.sendCommand('get_node_info', { nodeId: posterId });
      let shortCardId = null;

      if (nodeInfo.children) {
        for (const child of nodeInfo.children) {
          const nameLower = (child.name || '').toLowerCase().replace(/[\s\-_]/g, '');
          if (nameLower.includes('shortcard')) {
            shortCardId = child.id;
            console.log(`✅ 找到短图锚点: "${child.name}" (ID: ${shortCardId})`);
            break;
          }
        }
      }

      if (shortCardId) {
        const result3 = await this.sendCommand('resize_poster_to_fit', {
          posterId: posterId,
          anchorId: shortCardId,
          bottomPadding: 120
        });
        console.log('✅ 场景 3 成功:', result3);
      } else {
        console.log('⚠️ 未找到 shortCard 锚点，跳过场景 3');
      }
    } catch (error) {
      console.error('❌ 场景 3 失败:', error.message);
    }

    console.log('\n✅ 测试完成！请检查 Figma 中的海报高度是否正确调整');
    console.log('预期结果：');
    console.log('- 海报高度应该自动调整为内容底部 + padding');
    console.log('- 控制台应显示详细的日志信息');
    console.log('- 不应该出现 posterAbsY 未定义的错误');
  }

  async waitForEnter() {
    return new Promise(resolve => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function main() {
  const client = new ResizeTestClient();

  try {
    await client.connect();
    await client.testResizePosterToFit();
  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await client.close();
    process.exit(0);
  }
}

// 运行测试
main().catch(console.error);
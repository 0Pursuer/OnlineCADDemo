# 技术实现细节 (Technical Details)

## 1. Web Worker 通信协议
项目使用异步请求-响应模式。每个请求包含唯一的 `id`，Worker 处理完后通过 `postMessage` 返回对应 `id` 的结果。

### 消息结构：
```typescript
interface WorkerMessage {
  id: string;      // 随机 ID，用于 Promise 匹配
  action: string;  // 执行的操作 (e.g., 'RECOMPUTE')
  payload: any;    // 参数数据
}
```

---

## 2. 几何算法与缓存策略 (cad-worker.js)
为了保证复杂模型在修改参数时的流畅度，我们实现了 **Shape 级缓存**。

### 缓存逻辑：
- `shapeCache`：Key 为 `node.id`，存储 `{ shape, maker }`。
- **失效识别**：当节点被 UI 修改（用户拖动滑块）时，该节点及其**所有后继节点**会被标记为 `dirty`。
- **增量重算**：Worker 在执行 `RECOMPUTE` 时，会跳过那些依然 `valid` 的前缀节点，直接拉取缓存结果作为布尔运算的 `BaseShape`。

---

## 3. 内存回收机制
OCCT 对象在 JavaScript 环境下不会被 GC 自动清理，操作不当会导致内存溢出。

### 关键规则：
1. **显式销毁**：所有 `new occt.XXX()` 创建的对象必须调用 `.delete()`。
2. **所有权转移**：
   - 当一个形状被存入 `shapeCache` 时，所有权归缓存管理。
   - 当一个形状用于 `getMeshData` 转换后，如果它不是最终结果也不是缓存，必须立即调用 `.delete()`。
3. **临时变量清理**：在 `getMeshData` 内部，三角形遍历时产生的中间 `gp_Pnt` 和 `gp_Vec` 必须在每轮迭代末尾销毁。

---

## 4. 渲染优化 (Three.js)
- **零拷贝 (Transferables)**：Worker 返回的顶点数组通过 `MessagePort.postMessage(data, [data.buffer])` 进行所有权转移，避免大数据量的 CPU 拷贝开销。
- **自定义顶点属性**：直接映射 `Float32Array` 到 `THREE.BufferAttribute`。
- **动态 LOD**：
  ```javascript
  const linearDeflection = Math.max(0.01, Math.min(0.5, diagonal * 0.002));
  ```
  该算法保证了大型物体不因面片过多而掉帧，小型物体不因面片过少而显得圆柱不圆。

---

## 5. 交互式面拾取 (Face Picking)
系统支持亚精度的面级悬停高亮，采用 GPU 侧过滤以保证性能。

### 实现流程：
1. **Worker 生成 ID**：在 `getMeshData` 中，遍历 `TopoDS_Face` 时分配递增的 `faceIndex`。
2. **顶点属性传播**：将 `faceIndex` 写入每个顶点的 `aFaceId` 属性中（Float32BufferAttribute）。
3. **Raycast 节流**：主线程监听 `pointermove`，但在 `requestAnimationFrame` 中按需执行 `raycaster.intersectObject`。
4. **Shader 注入**：
   - 使用 `onBeforeCompile` 注入自定义 Uniform `uHoverFaceId`。
   - 在片元着色器中比较 `vFaceId` 与 `uHoverFaceId`，匹配时混合高亮颜色。
   - 优点：无需更新 CPU 缓冲区即可实现实时高亮，且保留了材质的原始光照（Phong）。

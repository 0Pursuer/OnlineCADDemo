# Online CAD Pro: 项目架构与技术文档

## 1. 项目简介
**Online CAD Pro** 是一个基于 Web 的级联参数化建模引擎。它利用 OpenCascade.js (WASM) 在浏览器中提供工业级的几何计算能力，配合 React 和 Three.js 实现高性能的 3D 交互。

### 核心亮点：
- **纯前端计算**：所有几何运算在 Web Worker 中进行，不依赖后端。
- **参数化历史**：支持类似 SolidWorks/FreeCAD 的特征树逻辑。
- **高性能渲染**：动态 LOD 网格生成，平衡视觉质量与性能。
- **鲁棒性**：节点级错误隔离，确保复杂的布尔运算不会导致崩溃。

---

## 2. 快速开始 (Clone & Use)

### 环境依赖
- **Node.js**: v18.x 或更高版本。
- **npm / yarn**: 现代包管理器。

### 安装步骤
1. 克隆仓库：
   ```bash
   git clone [repository-url]
   cd OnlineCADDemo
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 启动开发服务器：
   ```bash
   npm run dev
   ```
4. 访问 `http://localhost:5173` 即可开始建模。

---

## 3. 核心架构与逻辑

### 3.1 架构模型 (Multi-Threaded)
- **主线程 (React)**：负责 UI 状态、3D 渲染视图和用户输入管理。
- **计算线程 (Worker)**：负责加载 OpenCascade WASM 模块并执行耗时的几何运算。
- **通信层 (WorkerManager)**：利用 Promise 封装的异步通信机制。

### 3.2 几何计算逻辑 (cad-worker.js)
1. **级联重计算**：当某个节点脏化（Dirty）时，Worker 会从该节点开始顺序重算。
2. **缓存机制**：使用 `shapeCache` 存储中间步骤的 `TopoDS_Shape` 及其 `Maker`，避免重复计算。
3. **布尔运算链**：
   - 默认采用线性堆栈逻辑：`Result = PreviousResult ⊕ CurrentShape`。
   - `⊕` 代表用户选择的操作 (FUSE/CUT/COMMON)。

### 3.3 状态管理 (Zustand)
- 使用 `historyStore.ts` 统一管理 `nodes` 数组。
- 处理节点的新增、修改、删除及依赖传播（修改前置节点自动标记后置节点为 `dirty`）。

---

## 4. 已实现功能
- [x] **基本几何体**：Box, Cylinder, Sphere, Cone。
- [x] **交互式编辑**：实时平移、修改尺寸参数。
- [x] **级联布尔运算**：支持 Fuse/Cut/Common 及其历史回溯。
- [x] **可视化指示**：计算状态、错误警示、脏数据脉冲动画。
- [x] **内存管理**：定点修复了 OCCT 对象的各种内存泄漏点。

---

## 5. 优化方向 (Roadmap)
1. **几何特征增强**：倒角 (Fillet)、圆角 (Chamfer)、拉伸 (Extrude)。
2. **Undo/Redo**：基于快照的撤销重放。
3. **模型导出**：实现 STEP/STL/OBJ 导出。
4. **拓扑命名优化**：解决特征依赖中的面/边 ID 稳定性问题。

---

## 6. 开发者备注
- **内存安全**：在 Worker 中由于 WASM 不会自动内存回收，所有带有 `new` 的 OCCT 对象必须调用 `.delete()`。
- **UI 响应**：所有 3D 渲染数据通过 `ArrayBuffer` 零拷贝传输，以保持高帧率。

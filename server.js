const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'xiaomaibu-secret-key-2024';

// 中间件
app.use(cors());
app.use(express.json());

// API 配置
const API_KEY = process.env.API_KEY || 'sk-ceffb2a0d9ed4434bea191d2af26938c';
const API_URL = 'https://ws-nmmr37z4nmxzmz02.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

// MySQL 连接配置（修改成你的 MySQL 密码）
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'sjznzs'
};

// 创建连接池
const pool = mysql.createPool(dbConfig);

// 系统提示词（从数据库加载商品）
let SYSTEM_PROMPT = '';

async function loadSystemPrompt() {
    try {
        const [products] = await pool.query('SELECT * FROM products');
        SYSTEM_PROMPT = `你是"小卖部智能助手"，负责帮助顾客解答问题。

你的小卖部信息：
- 营业时间：每天早上8点到晚上10点
- 地址：XX路XX号
- 支付方式：微信、支付宝、现金
- 当前优惠：全场9折

商品列表：
${products.map(p => `- ${p.name}：${p.price}元，库存${p.stock}个`).join('\n')}

请用友好、简洁的语气回答顾客问题。如果问到商品库存或价格，请根据上面的数据回答。`;
    } catch (error) {
        console.error('加载商品数据失败:', error);
    }
}

// 启动时加载数据
loadSystemPrompt();

let chatHistory = [];
// 用户注册接口
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 检查用户名是否已存在
        const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (existing.length > 0) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);

        // 插入新用户（默认 role 为 user）
        await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, 'user']);

        res.json({ message: '注册成功' });
    } catch (error) {
        console.error('注册失败:', error);
        res.status(500).json({ error: '注册失败' });
    }
});
// 用户登录接口
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 先查管理员表
        const [admins] = await pool.query('SELECT * FROM admin_users WHERE username = ?', [username]);
        if (admins.length > 0 && await bcrypt.compare(password, admins[0].password)) {
            const token = jwt.sign({ id: admins[0].id, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({ token, username: admins[0].username, role: 'admin' });
        }

        // 再查普通用户表
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length > 0 && await bcrypt.compare(password, users[0].password)) {
            const token = jwt.sign({ id: users[0].id, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({ token, username: users[0].username, role: 'user' });
        }

        res.status(401).json({ error: '用户名或密码错误' });
    } catch (error) {
        console.error('登录失败:', error);
        res.status(500).json({ error: '登录失败' });
    }
});

// 验证 token 中间件
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未登录' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        res.status(401).json({ error: 'token 无效' });
    }
}

// 查询商品接口
app.get('/api/products', async (req, res) => {
    try {
        const { keyword, category } = req.query;
        let sql = 'SELECT * FROM products';
        let params = [];

        if (keyword) {
            sql += ' WHERE name LIKE ?';
            params.push(`%${keyword}%`);
        }
        if (category) {
            sql += keyword ? ' AND category = ?' : ' WHERE category = ?';
            params.push(category);
        }

        const [products] = await pool.query(sql, params);
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: '查询失败' });
    }
});
// 获取所有商品（管理员）
app.get('/api/admin/products', authMiddleware, async (req, res) => {
    try {
        const [products] = await pool.query('SELECT * FROM products ORDER BY id DESC');
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: '查询失败' });
    }
});

// 添加商品
app.post('/api/admin/products', authMiddleware, async (req, res) => {
    try {
        const { name, price, stock, category } = req.body;
        const [result] = await pool.query(
            'INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?)',
            [name, price, stock, category]
        );
        res.json({ id: result.insertId, message: '添加成功' });
    } catch (error) {
        res.status(500).json({ error: '添加失败' });
    }
});

// 更新商品
app.put('/api/admin/products/:id', authMiddleware, async (req, res) => {
    try {
        const { name, price, stock, category } = req.body;
        await pool.query(
            'UPDATE products SET name=?, price=?, stock=?, category=? WHERE id=?',
            [name, price, stock, category, req.params.id]
        );
        res.json({ message: '更新成功' });
    } catch (error) {
        res.status(500).json({ error: '更新失败' });
    }
});

// 删除商品
app.delete('/api/admin/products/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id=?', [req.params.id]);
        res.json({ message: '删除成功' });
    } catch (error) {
        res.status(500).json({ error: '删除失败' });
    }
});
// 聊天接口（需要登录）
app.post('/api/chat', authMiddleware, async (req, res) => {
    try {
        const { message } = req.body;

        // 每次对话前重新加载系统提示词（确保数据最新）
        await loadSystemPrompt();

        chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }, ...chatHistory.slice(-10)];
        chatHistory.push({ role: 'user', content: message });

        const response = await axios.post(
            API_URL,
            {
                model: 'qwen3.8-flash',
                messages: chatHistory
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const reply = response.data.choices[0].message.content;
        chatHistory.push({ role: 'assistant', content: reply });

        res.json({ reply });

    } catch (error) {
        console.error('API 调用失败:', error.message);
        res.status(500).json({ error: '服务暂时不可用' });
    }
});

// 启动服务器
app.listen(PORT, async () => {
    console.log(`后端服务运行在 http://localhost:${PORT}`);
    console.log('数据库连接成功！');
});
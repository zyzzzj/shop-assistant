// 清除旧缓存（解决角色权限问题）
if (localStorage.getItem('role') === 'admin' && !localStorage.getItem('_verified')) {
    localStorage.clear();
}
let token = localStorage.getItem('token');
let currentUser = localStorage.getItem('username');
let isAdmin = localStorage.getItem('role') === 'admin';
let editingProductId = null;
let isRegisterMode = false;

// 页面加载时检查登录状态
if (token) {
    showChat();
}

// 切换登录/注册表单
function toggleForm() {
    isRegisterMode = !isRegisterMode;
    const title = document.getElementById('formTitle');
    const btn = document.getElementById('submitBtn');
    const toggleText = document.getElementById('toggleText');

    if (isRegisterMode) {
        title.textContent = '用户注册';
        btn.textContent = '注册';
        btn.onclick = register;
        toggleText.innerHTML = '已有账号？<a href="javascript:void(0)" onclick="toggleForm()">立即登录</a>';
    } else {
        title.textContent = '商家登录';
        btn.textContent = '登录';
        btn.onclick = login;
        toggleText.innerHTML = '还没有账号？<a href="javascript:void(0)" onclick="toggleForm()">立即注册</a>';
    }
}

// 注册
async function register() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!username || !password) {
        alert('请填写用户名和密码');
        return;
    }

    try {
        await axios.post('http://localhost:3000/api/register', { username, password });
        alert('注册成功！请登录');
        toggleForm();
    } catch (error) {
        alert('注册失败：' + (error.response?.data?.error || '请检查网络'));
    }
}

// 登录
async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await axios.post('http://localhost:3000/api/login', { username, password });
        token = response.data.token;
        currentUser = response.data.username;

        // 保存登录信息
        localStorage.setItem('token', token);
        localStorage.setItem('username', currentUser);
        localStorage.setItem('role', response.data.role || 'user');
        isAdmin = (response.data.role === 'admin');

        showChat();
    } catch (error) {
        alert('登录失败：' + (error.response?.data?.error || '请检查网络'));
    }
}

// 显示聊天界面
function showChat() {
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';
    document.getElementById('adminContainer').style.display = 'none';

    // 管理员显示商品管理按钮
    if (isAdmin) {
        document.getElementById('adminBtn').style.display = 'inline-block';
    }

    // 添加欢迎消息
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages.children.length === 0) {
        addMessage('你好！我是小卖部助手，有什么可以帮你的？', 'bot');
    }
}

// 退出登录
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    token = null;
    currentUser = null;
    isAdmin = false;

    document.getElementById('loginContainer').style.display = 'flex';
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('adminContainer').style.display = 'none';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';

    // 重置为登录模式
    isRegisterMode = false;
    document.getElementById('formTitle').textContent = '商家登录';
    document.getElementById('submitBtn').textContent = '登录';
    document.getElementById('submitBtn').onclick = login;
    document.getElementById('toggleText').innerHTML = '还没有账号？<a href="javascript:void(0)" onclick="toggleForm()">立即注册</a>';
}

// 切换管理员界面
function toggleAdmin() {
    const chatContainer = document.getElementById('chatContainer');
    const adminContainer = document.getElementById('adminContainer');

    if (adminContainer.style.display === 'none') {
        chatContainer.style.display = 'none';
        adminContainer.style.display = 'flex';
        loadProducts();
    } else {
        adminContainer.style.display = 'none';
        chatContainer.style.display = 'flex';
    }
}

// 加载商品列表
async function loadProducts() {
    try {
        const response = await axios.get('http://localhost:3000/api/admin/products', {
            headers: { Authorization: `Bearer ${token}` }
        });
        renderProductTable(response.data);
    } catch (error) {
        alert('加载商品失败');
    }
}

// 渲染商品表格
function renderProductTable(products) {
    const tbody = document.getElementById('productTableBody');
    tbody.innerHTML = products.map(p => `
        <tr>
            <td>${p.id}</td>
            <td>${p.name}</td>
            <td>¥${p.price}</td>
            <td>${p.stock}</td>
            <td>${p.category}</td>
            <td>
                <button class="edit-btn" onclick="editProduct(${p.id}, '${p.name}', ${p.price}, ${p.stock}, '${p.category}')">编辑</button>
                <button class="delete-btn" onclick="deleteProduct(${p.id})">删除</button>
            </td>
        </tr>
    `).join('');
}

// 添加商品
async function addProduct() {
    const name = document.getElementById('addName').value;
    const price = document.getElementById('addPrice').value;
    const stock = document.getElementById('addStock').value;
    const category = document.getElementById('addCategory').value;

    if (!name || !price || !stock || !category) {
        alert('请填写完整信息');
        return;
    }

    try {
        await axios.post('http://localhost:3000/api/admin/products',
            { name, price: parseFloat(price), stock: parseInt(stock), category },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        // 清空输入框
        document.getElementById('addName').value = '';
        document.getElementById('addPrice').value = '';
        document.getElementById('addStock').value = '';
        document.getElementById('addCategory').value = '';

        loadProducts();
        alert('添加成功');
    } catch (error) {
        alert('添加失败');
    }
}

// 编辑商品
function editProduct(id, name, price, stock, category) {
    editingProductId = id;
    document.getElementById('addName').value = name;
    document.getElementById('addPrice').value = price;
    document.getElementById('addStock').value = stock;
    document.getElementById('addCategory').value = category;

    // 改变按钮文字
    event.target.closest('.add-product').querySelector('button').textContent = '更新';
}

// 更新商品
async function updateProduct() {
    const name = document.getElementById('addName').value;
    const price = document.getElementById('addPrice').value;
    const stock = document.getElementById('addStock').value;
    const category = document.getElementById('addCategory').value;

    try {
        await axios.put(`http://localhost:3000/api/admin/products/${editingProductId}`,
            { name, price: parseFloat(price), stock: parseInt(stock), category },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        editingProductId = null;
        document.getElementById('addName').value = '';
        document.getElementById('addPrice').value = '';
        document.getElementById('addStock').value = '';
        document.getElementById('addCategory').value = '';

        // 恢复按钮文字
        event.target.closest('.add-product').querySelector('button').textContent = '添加';

        loadProducts();
        alert('更新成功');
    } catch (error) {
        alert('更新失败');
    }
}

// 删除商品
async function deleteProduct(id) {
    if (!confirm('确定要删除这个商品吗？')) return;

    try {
        await axios.delete(`http://localhost:3000/api/admin/products/${id}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        loadProducts();
        alert('删除成功');
    } catch (error) {
        alert('删除失败');
    }
}

// 发送消息
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;

    addMessage(message, 'user');
    input.value = '';

    const loadingId = addMessage('正在思考...', 'bot');

    try {
        const response = await axios.post('http://localhost:3000/api/chat',
            { message },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        // 移除加载消息，添加真实回复
        document.getElementById(loadingId).remove();
        addMessage(response.data.reply, 'bot');
    } catch (error) {
        document.getElementById(loadingId).remove();
        addMessage('抱歉，服务暂时不可用，请稍后再试。', 'bot');
    }
}

// 添加消息到聊天界面
function addMessage(text, type) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = text;
    messageDiv.id = 'msg-' + Date.now();
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return messageDiv.id;
}

// 回车发送
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('messageInput');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }
});
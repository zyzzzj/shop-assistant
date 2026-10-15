from flask import Flask, request, jsonify
from flask_cors import CORS
import pymysql
import jwt
import bcrypt
import requests
import os
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
CORS(app)

PORT = 3000
JWT_SECRET = 'xiaomaibu-secret-key-2024'

# API 配置
API_KEY = os.getenv('API_KEY', 'sk-ceffb2a0d9ed4434bea191d2af26938c')
API_URL = 'https://ws-nmmr37z4nmxzmz02.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'

# MySQL 连接配置（修改成你的 MySQL 密码）
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', 'root'),
    'database': os.getenv('DB_NAME', 'sjznzs'),
    'cursorclass': pymysql.cursors.DictCursor
}

# 数据库连接辅助函数
def get_db_connection():
    return pymysql.connect(**DB_CONFIG)

# 系统提示词（从数据库加载商品）
SYSTEM_PROMPT = ''

def load_system_prompt():
    global SYSTEM_PROMPT
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM products')
        products = cursor.fetchall()
        
        product_list = '\n'.join([f"- {p['name']}：{p['price']}元，库存{p['stock']}个" for p in products])
        
        SYSTEM_PROMPT = f"""你是"小卖部智能助手"，负责帮助顾客解答问题。

你的小卖部信息：
- 营业时间：每天早上8点到晚上10点
- 地址：XX路XX号
- 支付方式：微信、支付宝、现金
- 当前优惠：全场9折

商品列表：
{product_list}

请用友好、简洁的语气回答顾客问题。如果问到商品库存或价格，请根据上面的数据回答。"""
        
        cursor.close()
        conn.close()
    except Exception as e:
        print(f'加载商品数据失败: {e}')

# 启动时加载数据
load_system_prompt()

chat_history = []

# 用户注册接口
@app.route('/api/register', methods=['POST'])
def register():
    try:
        data = request.json
        username = data['username']
        password = data['password']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 检查用户名是否已存在
        cursor.execute('SELECT * FROM users WHERE username = %s', [username])
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'error': '用户名已存在'}), 400
        
        # 加密密码
        hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # 插入新用户（默认 role 为 user）
        cursor.execute('INSERT INTO users (username, password, role) VALUES (%s, %s, %s)',
                      [username, hashed_password, 'user'])
        conn.commit()
        
        cursor.close()
        conn.close()
        
        return jsonify({'message': '注册成功'})
    except Exception as e:
        print(f'注册失败: {e}')
        return jsonify({'error': '注册失败'}), 500

# 用户登录接口
@app.route('/api/login', methods=['POST'])
def login():
    try:
        data = request.json
        username = data['username']
        password = data['password']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 先查管理员表
        cursor.execute('SELECT * FROM admin_users WHERE username = %s', [username])
        admin = cursor.fetchone()
        if admin and bcrypt.checkpw(password.encode('utf-8'), admin['password'].encode('utf-8')):
            token = jwt.encode({
                'id': admin['id'],
                'role': 'admin',
                'exp': datetime.utcnow() + timedelta(hours=24)
            }, JWT_SECRET, algorithm='HS256')
            cursor.close()
            conn.close()
            return jsonify({'token': token, 'username': admin['username'], 'role': 'admin'})
        
        # 再查普通用户表
        cursor.execute('SELECT * FROM users WHERE username = %s', [username])
        user = cursor.fetchone()
        if user and bcrypt.checkpw(password.encode('utf-8'), user['password'].encode('utf-8')):
            token = jwt.encode({
                'id': user['id'],
                'role': 'user',
                'exp': datetime.utcnow() + timedelta(hours=24)
            }, JWT_SECRET, algorithm='HS256')
            cursor.close()
            conn.close()
            return jsonify({'token': token, 'username': user['username'], 'role': 'user'})
        
        cursor.close()
        conn.close()
        return jsonify({'error': '用户名或密码错误'}), 401
    except Exception as e:
        print(f'登录失败: {e}')
        return jsonify({'error': '登录失败'}), 500

# 验证 token 装饰器
def auth_middleware(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        if auth_header:
            parts = auth_header.split(' ')
            if len(parts) == 2:
                token = parts[1]
        
        if not token:
            return jsonify({'error': '未登录'}), 401
        
        try:
            decoded = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            request.user = decoded
            return f(*args, **kwargs)
        except:
            return jsonify({'error': 'token 无效'}), 401
    
    return decorated

# 查询商品接口
@app.route('/api/products', methods=['GET'])
def get_products():
    try:
        keyword = request.args.get('keyword')
        category = request.args.get('category')
        
        sql = 'SELECT * FROM products'
        params = []
        
        if keyword:
            sql += ' WHERE name LIKE %s'
            params.append(f'%{keyword}%')
        
        if category:
            if keyword:
                sql += ' AND category = %s'
            else:
                sql += ' WHERE category = %s'
            params.append(category)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(sql, params)
        products = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        return jsonify(products)
    except Exception as e:
        print(f'查询失败: {e}')
        return jsonify({'error': '查询失败'}), 500

# 获取所有商品（管理员）
@app.route('/api/admin/products', methods=['GET'])
@auth_middleware
def get_admin_products():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM products ORDER BY id DESC')
        products = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        return jsonify(products)
    except Exception as e:
        print(f'查询失败: {e}')
        return jsonify({'error': '查询失败'}), 500

# 添加商品
@app.route('/api/admin/products', methods=['POST'])
@auth_middleware
def add_product():
    try:
        data = request.json
        name = data['name']
        price = data['price']
        stock = data['stock']
        category = data['category']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO products (name, price, stock, category) VALUES (%s, %s, %s, %s)',
            [name, price, stock, category]
        )
        conn.commit()
        product_id = cursor.lastrowid
        
        cursor.close()
        conn.close()
        
        return jsonify({'id': product_id, 'message': '添加成功'})
    except Exception as e:
        print(f'添加失败: {e}')
        return jsonify({'error': '添加失败'}), 500

# 更新商品
@app.route('/api/admin/products/<int:product_id>', methods=['PUT'])
@auth_middleware
def update_product(product_id):
    try:
        data = request.json
        name = data['name']
        price = data['price']
        stock = data['stock']
        category = data['category']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE products SET name=%s, price=%s, stock=%s, category=%s WHERE id=%s',
            [name, price, stock, category, product_id]
        )
        conn.commit()
        
        cursor.close()
        conn.close()
        
        return jsonify({'message': '更新成功'})
    except Exception as e:
        print(f'更新失败: {e}')
        return jsonify({'error': '更新失败'}), 500

# 删除商品
@app.route('/api/admin/products/<int:product_id>', methods=['DELETE'])
@auth_middleware
def delete_product(product_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM products WHERE id=%s', [product_id])
        conn.commit()
        
        cursor.close()
        conn.close()
        
        return jsonify({'message': '删除成功'})
    except Exception as e:
        print(f'删除失败: {e}')
        return jsonify({'error': '删除失败'}), 500

# 聊天接口（需要登录）
@app.route('/api/chat', methods=['POST'])
@auth_middleware
def chat():
    global chat_history
    try:
        data = request.json
        message = data['message']
        
        # 每次对话前重新加载系统提示词（确保数据最新）
        load_system_prompt()
        
        chat_history = [{'role': 'system', 'content': SYSTEM_PROMPT}] + chat_history[-10:]
        chat_history.append({'role': 'user', 'content': message})
        
        response = requests.post(
            API_URL,
            json={
                'model': 'qwen3.8-flash',
                'messages': chat_history
            },
            headers={
                'Authorization': f'Bearer {API_KEY}',
                'Content-Type': 'application/json'
            }
        )
        
        reply = response.json()['choices'][0]['message']['content']
        chat_history.append({'role': 'assistant', 'content': reply})
        
        return jsonify({'reply': reply})
    except Exception as e:
        print(f'API 调用失败: {e}')
        return jsonify({'error': '服务暂时不可用'}), 500

if __name__ == '__main__':
    print(f'后端服务运行在 http://localhost:{PORT}')
    print('数据库连接成功！')
    app.run(host='0.0.0.0', port=PORT, debug=True)
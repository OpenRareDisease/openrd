from flask import Flask
from flask_restx import Api
from flask_sqlalchemy import SQLAlchemy
from config import Config

# 初始化数据库
db = SQLAlchemy()

# 初始化API
api = Api(
    title='Report Manager API',
    version='1.0',
    description='API for managing medical reports',
    doc='/swagger'
)

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    
    # 初始化数据库
    db.init_app(app)
    
    # 初始化API
    api.init_app(app)
    
    # 创建数据库表
    with app.app_context():
        db.create_all()
    
    # 导入并注册路由
    from app.routes.user_routes import user_ns
    from app.routes.report_routes import report_ns
    
    api.add_namespace(user_ns, path='/api/users')
    api.add_namespace(report_ns, path='/api/reports')
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)
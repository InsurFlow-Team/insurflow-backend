const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { errorResponse } = require('../utils/apiResponse');

/**
 * Authentication Middleware
 * Validates the JWT and attaches user context to the request.
 */
const authenticate = (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json(errorResponse('Unauthorized: Missing token'));
  }

  try {
    // 1. تحديد الخوارزمية بشكل صريح (Algorithm Confusion Prevention)
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'] 
    });
    
    // 2. التحقق من وجود البيانات الأساسية (Payload Validation)
    if (!decoded || !decoded.userId) {
      return res.status(401).json(errorResponse('Unauthorized: Invalid token payload'));
    }
    
    // Attach the authenticated user context to the request object
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      organizationId: decoded.organizationId,
    };
    
    // ملاحظة: يُنصح بإضافة فحص هنا أو في middleware آخر للتحقق من حالة المستخدم (بنشط، محظور، الخ) 
    // من قاعدة البيانات إذا كان النظام يتطلب أماناً عالياً.
    
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(errorResponse('Unauthorized: Token has expired'));
    }
    return res.status(401).json(errorResponse('Unauthorized: Invalid token'));
  }
};

module.exports = authenticate;

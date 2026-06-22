// Simple script to login and create a test user
(async () => {
  const loginRes = await fetch('http://localhost:4000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  if (!loginRes.ok) {
    console.error('Login failed', loginRes.status);
    return;
  }
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('Logged in, token length', token.length);

  const userRes = await fetch('http://localhost:4000/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'اختبار',
      username: 'testuser_js',
      password: 'test123',
      role: 'user',
      phone: '0123456789',
      isActive: true,
      permissions: {}
    })
  });
  const resultText = await userRes.text();
  console.log('User create status', userRes.status);
  console.log('Response:', resultText);
})();

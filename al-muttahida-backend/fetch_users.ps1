$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -Headers @{ 'Content-Type'='application/json' } -Body '{"email":"admin@almuttahida.com","password":"admin123"}'
$token = $login.token
Write-Output $token
$response = curl.exe -s -H "Authorization: Bearer $token" http://localhost:4000/users
Write-Output $response

@echo off
setlocal
cd /d "%~dp0"
echo.
echo MyPurePlan - Supabase connection setup
echo Paste the Project URL and the PUBLIC publishable key from Supabase.
echo Do NOT paste a service_role or secret key.
echo.
set /p SUPABASE_URL=Project URL: 
set /p SUPABASE_KEY=Publishable key (sb_publishable_...): 
if "%SUPABASE_URL%"=="" goto missing
if "%SUPABASE_KEY%"=="" goto missing
>".env.local" echo VITE_SUPABASE_URL=%SUPABASE_URL%
>>".env.local" echo VITE_SUPABASE_PUBLISHABLE_KEY=%SUPABASE_KEY%
echo.
echo Saved .env.local in the MyPurePlan folder.
echo Restart the Vite development server after setup.
echo Your key stays in this local file. Do not upload or share this file.
goto end
:missing
echo Missing URL or key. No connection file was created.
:end
pause
endlocal

import sql from 'mssql';
import { config } from './config.js';
import { uid } from './utils.js';

interface TestStepResult {
  step: string;
  passed: boolean;
  message: string;
  durationMs?: number;
}

const results: TestStepResult[] = [];

function logStep(step: string, passed: boolean, message: string, durationMs?: number) {
  results.push({ step, passed, message, durationMs });
  const icon = passed ? '✅' : '❌';
  const durationText = durationMs !== undefined ? ` (${durationMs.toFixed(1)}ms)` : '';
  console.log(`${icon} [${step}] ${message}${durationText}`);
}

async function runSqlServerIntegrationTest() {
  console.log('\n================================================================');
  console.log('   AL-MUTTAHIDA ERP - SQL SERVER WRITE & READ INTEGRATION TEST  ');
  console.log('================================================================\n');

  let pool: any = null;
  const testCustomerId = `test-cust-${uid()}`;
  const testCustomerNumber = `TEST-${Date.now().toString().slice(-6)}`;
  const testAuditId = `test-audit-${uid()}`;
  const timestamp = new Date().toISOString();

  try {
    // -------------------------------------------------------------
    // Step 1: Direct Connection Verification
    // -------------------------------------------------------------
    console.log('--- Step 1: Direct Connection Handshake ---');
    const connStart = performance.now();
    
    pool = await sql.connect(config.sql);
    const connDuration = performance.now() - connStart;

    const serverInfoResult = await pool.request().query(`
      SELECT 
        @@SERVERNAME AS serverName,
        DB_NAME() AS currentDb,
        SERVERPROPERTY('ProductVersion') AS productVersion,
        SERVERPROPERTY('ProductLevel') AS productLevel,
        SERVERPROPERTY('Collation') AS collation
    `);
    const serverInfo = serverInfoResult.recordset[0];

    logStep(
      'Connection',
      true,
      `Handshake successful with SQL Server at ${config.sql.server}:${config.sql.port} -> Database: "${serverInfo.currentDb}" (Version: ${serverInfo.productVersion}, Collation: ${serverInfo.collation})`,
      connDuration
    );

    // -------------------------------------------------------------
    // Step 2: Write / Insert Test (Arabic Unicode & Decimal Test)
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Write / Insert Operations ---');

    // 2.1 Insert into `customers`
    const insertCustStart = performance.now();
    const testCustomerData = {
      id: testCustomerId,
      customer_number: testCustomerNumber,
      name: 'عميل اختبار تكامل قاعدة البيانات (Integration Test Customer)',
      phone: '01012345678',
      email: 'integration.test@almuttahida.local',
      address: 'شارع الجمهورية - عمارة الاختبار - القاهرة',
      gender: 'male',
      city: 'القاهرة',
      governorate: 'القاهرة',
      region: 'وسط البلد',
      date_of_birth: '1988-06-15',
      national_id: '28806151234567',
      age: 38,
      pension_date: '2048-06-15',
      balance: 4750.75,
      balance_type: 'debtor',
      notes: 'سجل مؤقت تم إنشاؤه بواسطة سكريبت اختبار التكامل للتحقق من سلامة الكتابة والقراءة المباشرة على SQL Server.',
      is_sued: 0,
      created_at: timestamp,
      updated_at: timestamp,
    };

    const custInsertReq = pool.request();
    custInsertReq.input('id', sql.NVarChar(64), testCustomerData.id);
    custInsertReq.input('customer_number', sql.NVarChar(100), testCustomerData.customer_number);
    custInsertReq.input('name', sql.NVarChar(200), testCustomerData.name);
    custInsertReq.input('phone', sql.NVarChar(50), testCustomerData.phone);
    custInsertReq.input('email', sql.NVarChar(255), testCustomerData.email);
    custInsertReq.input('address', sql.NVarChar(500), testCustomerData.address);
    custInsertReq.input('gender', sql.NVarChar(10), testCustomerData.gender);
    custInsertReq.input('city', sql.NVarChar(100), testCustomerData.city);
    custInsertReq.input('governorate', sql.NVarChar(100), testCustomerData.governorate);
    custInsertReq.input('region', sql.NVarChar(100), testCustomerData.region);
    custInsertReq.input('date_of_birth', sql.NVarChar(20), testCustomerData.date_of_birth);
    custInsertReq.input('national_id', sql.NVarChar(50), testCustomerData.national_id);
    custInsertReq.input('age', sql.Int, testCustomerData.age);
    custInsertReq.input('pension_date', sql.NVarChar(20), testCustomerData.pension_date);
    custInsertReq.input('balance', sql.Decimal(18, 2), testCustomerData.balance);
    custInsertReq.input('balance_type', sql.NVarChar(10), testCustomerData.balance_type);
    custInsertReq.input('notes', sql.NVarChar(1000), testCustomerData.notes);
    custInsertReq.input('is_sued', sql.Bit, testCustomerData.is_sued);
    custInsertReq.input('created_at', sql.NVarChar(40), testCustomerData.created_at);
    custInsertReq.input('updated_at', sql.NVarChar(40), testCustomerData.updated_at);

    await custInsertReq.query(`
      INSERT INTO customers (
        id, customer_number, name, phone, email, address, gender,
        city, governorate, region, date_of_birth, national_id, age,
        pension_date, balance, balance_type, notes, is_sued, created_at, updated_at
      ) VALUES (
        @id, @customer_number, @name, @phone, @email, @address, @gender,
        @city, @governorate, @region, @date_of_birth, @national_id, @age,
        @pension_date, @balance, @balance_type, @notes, @is_sued, @created_at, @updated_at
      )
    `);
    const insertCustDuration = performance.now() - insertCustStart;
    logStep(
      'Write: Customers',
      true,
      `Inserted record into [customers] (ID: "${testCustomerId}", Number: "${testCustomerNumber}")`,
      insertCustDuration
    );

    // 2.2 Insert into `audit_log`
    const insertAuditStart = performance.now();
    const testAuditPayload = JSON.stringify({
      operation: 'INTEGRATION_TEST_WRITE_VERIFICATION',
      targetId: testCustomerId,
      timestamp,
      verified: true
    });

    const auditInsertReq = pool.request();
    auditInsertReq.input('id', sql.NVarChar(64), testAuditId);
    auditInsertReq.input('action', sql.NVarChar(100), 'INTEGRATION_TEST_WRITE');
    auditInsertReq.input('entity_type', sql.NVarChar(50), 'customer_verification');
    auditInsertReq.input('entity_id', sql.NVarChar(64), testCustomerId);
    auditInsertReq.input('payload', sql.NVarChar(sql.MAX), testAuditPayload);
    auditInsertReq.input('created_by', sql.NVarChar(200), 'SQL Server Integration Suite');
    auditInsertReq.input('created_at', sql.NVarChar(40), timestamp);

    await auditInsertReq.query(`
      INSERT INTO audit_log (
        id, action, entity_type, entity_id, payload, created_by, created_at
      ) VALUES (
        @id, @action, @entity_type, @entity_id, @payload, @created_by, @created_at
      )
    `);
    const insertAuditDuration = performance.now() - insertAuditStart;
    logStep(
      'Write: AuditLog',
      true,
      `Inserted record into [audit_log] (ID: "${testAuditId}", Action: "INTEGRATION_TEST_WRITE")`,
      insertAuditDuration
    );

    // -------------------------------------------------------------
    // Step 3: Read / Fetch Verification
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Read / Fetch Verification ---');

    // 3.1 Fetch customer record
    const fetchCustStart = performance.now();
    const fetchCustReq = pool.request();
    fetchCustReq.input('id', sql.NVarChar(64), testCustomerId);
    const fetchCustResult = await fetchCustReq.query('SELECT * FROM customers WHERE id = @id');
    const fetchedCust = fetchCustResult.recordset[0];
    const fetchCustDuration = performance.now() - fetchCustStart;

    if (!fetchedCust) {
      logStep('Read: Customers', false, `Failed to retrieve customer with ID "${testCustomerId}" from SQL Server!`);
      throw new Error('Customer record not found after insert');
    }

    // Verify fields
    const nameMatch = fetchedCust.name === testCustomerData.name;
    const numMatch = fetchedCust.customer_number === testCustomerData.customer_number;
    const nationalIdMatch = fetchedCust.national_id === testCustomerData.national_id;
    const balanceMatch = Number(fetchedCust.balance) === testCustomerData.balance;
    const createdAtMatch = fetchedCust.created_at === testCustomerData.created_at;

    if (nameMatch && numMatch && nationalIdMatch && balanceMatch && createdAtMatch) {
      logStep(
        'Read: Customers',
        true,
        `Retrieved customer successfully. All fields matched: Name (Arabic Unicode ok: "${fetchedCust.name.slice(0, 32)}..."), Balance: ${fetchedCust.balance}, NationalId: ${fetchedCust.national_id}`,
        fetchCustDuration
      );
    } else {
      const mismatches = [];
      if (!nameMatch) mismatches.push(`name (expected: ${testCustomerData.name}, got: ${fetchedCust.name})`);
      if (!numMatch) mismatches.push(`customer_number`);
      if (!nationalIdMatch) mismatches.push(`national_id`);
      if (!balanceMatch) mismatches.push(`balance (expected: ${testCustomerData.balance}, got: ${fetchedCust.balance})`);
      if (!createdAtMatch) mismatches.push(`created_at`);
      logStep('Read: Customers', false, `Customer field mismatch: ${mismatches.join(', ')}`);
      throw new Error('Customer field mismatch');
    }

    // 3.2 Fetch audit_log record
    const fetchAuditStart = performance.now();
    const fetchAuditReq = pool.request();
    fetchAuditReq.input('id', sql.NVarChar(64), testAuditId);
    const fetchAuditResult = await fetchAuditReq.query('SELECT * FROM audit_log WHERE id = @id');
    const fetchedAudit = fetchAuditResult.recordset[0];
    const fetchAuditDuration = performance.now() - fetchAuditStart;

    if (!fetchedAudit) {
      logStep('Read: AuditLog', false, `Failed to retrieve audit log with ID "${testAuditId}" from SQL Server!`);
      throw new Error('Audit log record not found after insert');
    }

    const actionMatch = fetchedAudit.action === 'INTEGRATION_TEST_WRITE';
    const entityMatch = fetchedAudit.entity_id === testCustomerId;
    const parsedPayload = JSON.parse(fetchedAudit.payload || '{}');
    const payloadMatch = parsedPayload.operation === 'INTEGRATION_TEST_WRITE_VERIFICATION';

    if (actionMatch && entityMatch && payloadMatch) {
      logStep(
        'Read: AuditLog',
        true,
        `Retrieved audit log successfully. Action: "${fetchedAudit.action}", EntityId: "${fetchedAudit.entity_id}", Payload JSON parsed and verified.`,
        fetchAuditDuration
      );
    } else {
      logStep('Read: AuditLog', false, 'Audit log field mismatch detected');
      throw new Error('Audit log field mismatch');
    }

    // -------------------------------------------------------------
    // Step 4: Cleanup Operations
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Cleanup Verification ---');

    const cleanupStart = performance.now();
    
    // Delete customer
    const delCustReq = pool.request();
    delCustReq.input('id', sql.NVarChar(64), testCustomerId);
    await delCustReq.query('DELETE FROM customers WHERE id = @id');

    // Delete audit log
    const delAuditReq = pool.request();
    delAuditReq.input('id', sql.NVarChar(64), testAuditId);
    await delAuditReq.query('DELETE FROM audit_log WHERE id = @id');

    // Verify deletion
    const verifyCustDel = await pool.request().input('id', sql.NVarChar(64), testCustomerId).query('SELECT COUNT(*) AS cnt FROM customers WHERE id = @id');
    const verifyAuditDel = await pool.request().input('id', sql.NVarChar(64), testAuditId).query('SELECT COUNT(*) AS cnt FROM audit_log WHERE id = @id');

    const custDeleted = verifyCustDel.recordset[0].cnt === 0;
    const auditDeleted = verifyAuditDel.recordset[0].cnt === 0;
    const cleanupDuration = performance.now() - cleanupStart;

    if (custDeleted && auditDeleted) {
      logStep(
        'Cleanup',
        true,
        `Safely deleted test records from [customers] and [audit_log]. Confirmed 0 lingering test rows in SQL Server.`,
        cleanupDuration
      );
    } else {
      logStep('Cleanup', false, 'Lingering test records detected after DELETE operation!');
      throw new Error('Cleanup verification failed');
    }

  } catch (err: any) {
    console.error('\n❌ INTEGRATION TEST FAILED with error:', err.message);
    if (pool) {
      // Attempt emergency cleanup if error occurred after insert
      try {
        await pool.request().query(`DELETE FROM customers WHERE id = '${testCustomerId}'`);
        await pool.request().query(`DELETE FROM audit_log WHERE id = '${testAuditId}'`);
        console.log('⚠️ Emergency cleanup completed for test IDs.');
      } catch (_) {}
    }
    process.exitCode = 1;
  } finally {
    if (pool) {
      await pool.close();
      console.log('SQL Server pool connection closed.');
    }
  }

  // -------------------------------------------------------------
  // Step 5: Summary Report
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                   INTEGRATION TEST SUMMARY                     ');
  console.log('================================================================');
  const allPassed = results.every(r => r.passed);
  results.forEach(r => {
    const icon = r.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`- ${r.step.padEnd(20)}: ${icon}`);
  });
  console.log('----------------------------------------------------------------');
  if (allPassed) {
    console.log('🎉 RESULT: 100% OPERATIONAL READINESS CONFIRMED FOR SQL SERVER!');
  } else {
    console.log('⚠️ RESULT: ONE OR MORE INTEGRATION TEST STEPS FAILED.');
  }
  console.log('================================================================\n');
}

runSqlServerIntegrationTest();

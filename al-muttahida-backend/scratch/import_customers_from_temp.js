import crypto from 'node:crypto';
import sql from 'mssql';

const sourceDatabase = 'INV_DB_IMPORT_TEMP';
const targetDatabase = process.env.TARGET_DB || 'AlMuttahida_New';

const clean = (value) => String(value ?? '').trim();
const digits = (value) => clean(value).replace(/\D/g, '');

function dateFromEgyptianNationalId(nationalId) {
  const value = digits(nationalId);
  if (value.length !== 14) return '';

  const century = value[0] === '2' ? 1900 : value[0] === '3' ? 2000 : null;
  if (!century) return '';

  const year = century + Number(value.slice(1, 3));
  const month = Number(value.slice(3, 5));
  const day = Number(value.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function ageFromDate(dateText) {
  if (!dateText) return 0;
  const [year, month, day] = dateText.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) {
    age -= 1;
  }
  return Math.max(0, age);
}

function gender(value) {
  const text = clean(value);
  if (text.includes('أنث') || text.includes('انث') || /^f/i.test(text)) return 'female';
  return 'male';
}

function balanceType(value) {
  const text = clean(value);
  if (text.includes('دائن') || /credit/i.test(text)) return 'creditor';
  return 'debtor';
}

function guarantor(row, index) {
  const item = {
    name: clean(row[`name_damn${index}`]),
    address: clean(row[`adress_damn${index}`]),
    nationalId: digits(row[`id_damn${index}`]),
    phone: digits(row[`phone_damn${index}`]),
    relationship: clean(row[`relation${index}`]),
  };
  return Object.values(item).some(Boolean) ? item : null;
}

function imageData(value) {
  if (!Buffer.isBuffer(value) || value.length === 0) return null;
  return `data:image/jpeg;base64,${value.toString('base64')}`;
}

const config = {
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sallam',
  password: process.env.DB_PASSWORD || 'ah123',
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const pool = await sql.connect(config);
const transaction = new sql.Transaction(pool);

try {
  const source = await pool.request().query(`
    SELECT *
    FROM [${sourceDatabase}].[dbo].[Customer]
    ORDER BY ID
  `);

  await transaction.begin();
  let inserted = 0;
  let skipped = 0;

  for (const row of source.recordset) {
    const customerNumber = clean(row.CustomerID) || `OLD-${row.ID}`;
    const exists = await new sql.Request(transaction)
      .input('customerNumber', sql.NVarChar, customerNumber)
      .query(`SELECT id FROM [${targetDatabase}].[dbo].[customers] WHERE customer_number = @customerNumber`);

    if (exists.recordset.length > 0) {
      skipped += 1;
      continue;
    }

    const nationalId = digits(row.ZipCode) || `OLD${String(row.ID).padStart(11, '0')}`;
    const dateOfBirth = dateFromEgyptianNationalId(nationalId);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const name = clean(row.Name) || customerNumber;
    const city = clean(row.City) || clean(row.State) || 'غير محدد';
    const governorate = clean(row.State) || city;
    const address = clean(row.Address) || 'غير محدد';
    const importedGuarantors = [guarantor(row, 1), guarantor(row, 2), guarantor(row, 3)];

    await new sql.Request(transaction)
      .input('id', sql.NVarChar, id)
      .input('customerNumber', sql.NVarChar, customerNumber)
      .input('name', sql.NVarChar, name)
      .input('phone', sql.NVarChar, digits(row.ContactNo) || 'غير محدد')
      .input('email', sql.NVarChar, clean(row.EmailID) || null)
      .input('address', sql.NVarChar, address)
      .input('gender', sql.NVarChar, gender(row.Gender))
      .input('city', sql.NVarChar, city)
      .input('governorate', sql.NVarChar, governorate)
      .input('region', sql.NVarChar, clean(row.Address) || city)
      .input('dateOfBirth', sql.NVarChar, dateOfBirth)
      .input('nationalId', sql.NVarChar, nationalId)
      .input('age', sql.Int, ageFromDate(dateOfBirth))
      .input('pensionDate', sql.NVarChar, '')
      .input('balance', sql.Decimal(18, 2), Number(row.OpeningBalance || 0))
      .input('balanceType', sql.NVarChar, balanceType(row.OpeningBalanceType))
      .input('notes', sql.NVarChar, clean(row.Remarks) || null)
      .input('image', sql.NVarChar(sql.MAX), imageData(row.Photo))
      .input('guarantors', sql.NVarChar(sql.MAX), JSON.stringify(importedGuarantors))
      .input('createdAt', sql.NVarChar, now)
      .input('updatedAt', sql.NVarChar, now)
      .query(`
        INSERT INTO [${targetDatabase}].[dbo].[customers] (
          id, customer_number, name, phone, email, address, gender, city, governorate, region,
          date_of_birth, national_id, age, pension_date, balance, balance_type,
          notes, image, guarantors, is_sued, sued_date, created_at, updated_at
        )
        VALUES (
          @id, @customerNumber, @name, @phone, @email, @address, @gender, @city, @governorate, @region,
          @dateOfBirth, @nationalId, @age, @pensionDate, @balance, @balanceType,
          @notes, @image, @guarantors, 0, NULL, @createdAt, @updatedAt
        )
      `);

    inserted += 1;
  }

  await transaction.commit();
  console.log(JSON.stringify({ sourceRows: source.recordset.length, inserted, skipped }, null, 2));
} catch (error) {
  if (transaction._aborted === false) {
    await transaction.rollback();
  }
  throw error;
} finally {
  await pool.close();
}

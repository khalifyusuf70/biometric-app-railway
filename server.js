const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ================== RAILWAY POSTGRESQL CONNECTION ==================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected successfully to Railway');
    
    // Log database info (without exposing full URL)
    if (process.env.DATABASE_URL) {
      const url = process.env.DATABASE_URL;
      const safeUrl = url.replace(/:\/\/.*@/, '://****:****@');
      console.log(`📊 Connected to: ${safeUrl}`);
      
      // Extract hostname for debugging
      const match = url.match(/@([^:]+):(\d+)\//);
      if (match) {
        console.log(`🌐 Host: ${match[1]}, Port: ${match[2]}`);
      }
    }
    
    // Test query to verify connection
    const result = await client.query('SELECT NOW() as server_time');
    console.log(`⏰ Database server time: ${result.rows[0].server_time}`);
    
    client.release();
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
    console.log('⚠️ Make sure DATABASE_URL is set in Railway environment variables');
    
    // Log the DATABASE_URL (sanitized) for debugging
    if (process.env.DATABASE_URL) {
      const url = process.env.DATABASE_URL;
      const safeUrl = url.replace(/:\/\/.*@/, '://****:****@');
      console.log(`🔍 Current DATABASE_URL: ${safeUrl}`);
    } else {
      console.log('🔍 DATABASE_URL environment variable is NOT set');
    }
  }
}
testConnection();

// ================== DEBUG ENDPOINTS ==================

// 1. Database connection test endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    // Test basic connection
    const timeResult = await pool.query('SELECT NOW() as current_time');
    
    // Check if soldiers table exists
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%soldiers%'
      ORDER BY table_name
    `);
    
    // Count soldiers in each table
    const counts = {};
    for (const row of tablesResult.rows) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${row.table_name}`);
        counts[row.table_name] = parseInt(countResult.rows[0].count);
      } catch (err) {
        counts[row.table_name] = `Error: ${err.message}`;
      }
    }
    
    res.json({
      success: true,
      database: 'connected',
      current_time: timeResult.rows[0].current_time,
      available_tables: tablesResult.rows.map(row => row.table_name),
      table_counts: counts,
      total_soldiers: Object.values(counts).reduce((sum, count) => sum + (typeof count === 'number' ? count : 0), 0)
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      connection_test: 'failed'
    });
  }
});

// 2. Check specific soldiers count
app.get('/api/check-soldiers', async (req, res) => {
  try {
    // Check all possible soldier tables
    const tablesToCheck = [
      'soldiersrepository',
      'statehouse_soldiers',
      'police_soldiers', 
      'darawish_soldiers',
      'nawadsugida_soldiers'
    ];
    
    const results = {};
    let totalSoldiers = 0;
    
    for (const table of tablesToCheck) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        const count = parseInt(result.rows[0].count);
        results[table] = count;
        totalSoldiers += count;
      } catch (err) {
        // Table might not exist
        results[table] = `Table not found: ${err.message}`;
      }
    }
    
    res.json({
      success: true,
      message: `Found ${totalSoldiers} soldiers total across all tables`,
      total_soldiers: totalSoldiers,
      table_counts: results
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      hint: 'Table might not exist or connection issue'
    });
  }
});

// 3. Environment variables dump (sanitized)
app.get('/api/env', (req, res) => {
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATABASE_URL_SET: !!process.env.DATABASE_URL,
    DATABASE_URL_LENGTH: process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0,
    // Sanitize DATABASE_URL for security
    DATABASE_URL_SANITIZED: process.env.DATABASE_URL ? 
      process.env.DATABASE_URL.replace(/:\/\/.*@/, '://****:****@') : 
      'Not set'
  };
  
  res.json({ success: true, environment: env });
});

// 4. Force-specific soldier count
app.get('/api/soldiers-count/:force', async (req, res) => {
  try {
    const { force } = req.params;
    
    // Force-specific table names
    const forceTables = {
      'statehouse': 'statehouse_soldiers',
      'police': 'police_soldiers',
      'darawish': 'darawish_soldiers',
      'nawadsugida': 'nawadsugida_soldiers'
    };
    
    const tableName = forceTables[force];
    
    if (!tableName) {
      return res.status(400).json({
        success: false,
        error: `Invalid force: ${force}. Valid forces: ${Object.keys(forceTables).join(', ')}`
      });
    }
    
    let count = 0;
    let message = '';
    
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      count = parseInt(result.rows[0].count);
      message = `Found ${count} soldiers in ${force}`;
    } catch (tableError) {
      // Try soldiersrepository for backward compatibility (statehouse only)
      if (force === 'statehouse') {
        try {
          const result = await pool.query('SELECT COUNT(*) as count FROM soldiersrepository');
          count = parseInt(result.rows[0].count);
          message = `Found ${count} soldiers in old soldiersrepository table`;
        } catch (oldTableError) {
          message = `No table found for ${force}: ${oldTableError.message}`;
        }
      } else {
        message = `Table ${tableName} not found: ${tableError.message}`;
      }
    }
    
    res.json({
      success: true,
      force: force,
      count: count,
      message: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================== FILE DEBUGGING ENDPOINT ==================

// Debug endpoint to check file existence
app.get('/debug-files', (req, res) => {
  try {
    const publicPath = path.join(__dirname, 'public');
    const indexPath = path.join(__dirname, 'public', 'index.html');
    const publicExists = fs.existsSync(publicPath);
    const indexExists = fs.existsSync(indexPath);
    
    res.json({
      success: true,
      __dirname: __dirname,
      public_path: publicPath,
      public_exists: publicExists,
      index_path: indexPath,
      index_exists: indexExists,
      files_in_public: publicExists ? fs.readdirSync(publicPath) : 'public folder not found',
      current_dir_files: fs.readdirSync(__dirname)
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// ================== DIRECT ROUTE FOR QUICK ACCESS ==================

// Direct route for root - Quick Access Page
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Jubaland Forces - Quick Access</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
    .container { max-width: 800px; margin: 0 auto; }
    .header { background: #2c3e50; color: white; padding: 20px; border-radius: 10px 10px 0 0; }
    .card { background: white; padding: 20px; margin: 20px 0; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .api-link { background: #e3f2fd; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #2196f3; }
    .api-link:hover { background: #bbdefb; }
    a { color: #2196f3; text-decoration: none; font-weight: bold; }
    a:hover { text-decoration: underline; }
    .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
    .status.online { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .status.offline { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    .forces-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 20px 0; }
    .force-item { background: #f8f9fa; padding: 15px; border-radius: 5px; text-align: center; }
    .force-item:hover { background: #e9ecef; }
    @media (max-width: 600px) {
      .forces-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎖️ Jubaland Multi-Forces Database System</h1>
      <p>Railway Deployment - Quick Access Portal</p>
    </div>
    
    <div class="card">
      <h3>✅ System Status</h3>
      <div class="status online">
        <strong>Database:</strong> Connected<br>
        <strong>API:</strong> Operational<br>
        <strong>Frontend:</strong> Loading from public folder
      </div>
    </div>
    
    <div class="card">
      <h3>🔗 Quick Links</h3>
      
      <div class="api-link">
        <a href="/api/soldiers/statehouse" target="_blank">👥 View Statehouse Soldiers (972+)</a>
        <p>View complete list of soldiers with all details</p>
      </div>
      
      <div class="api-link">
        <a href="/api/executive-dashboard" target="_blank">📊 Executive Dashboard</a>
        <p>Analytics and statistics for decision making</p>
      </div>
      
      <div class="api-link">
        <a href="/api" target="_blank">📚 API Documentation</a>
        <p>Complete API endpoints and usage guide</p>
      </div>
      
      <div class="api-link">
        <a href="/debug-files" target="_blank">🔍 Debug Files</a>
        <p>Check if public folder and files exist</p>
      </div>
      
      <div class="api-link">
        <a href="/api/test-db" target="_blank">🧪 Test Database Connection</a>
        <p>Verify PostgreSQL connection to Railway</p>
      </div>
    </div>
    
    <div class="card">
      <h3>🎖️ Available Forces</h3>
      <div class="forces-grid">
        <div class="force-item">
          <strong>Statehouse Forces</strong><br>
          <a href="/api/soldiers/statehouse">View Soldiers</a>
        </div>
        <div class="force-item">
          <strong>Police Force</strong><br>
          <a href="/api/soldiers/police">View Soldiers</a>
        </div>
        <div class="force-item">
          <strong>Darawish Forces</strong><br>
          <a href="/api/soldiers/darawish">View Soldiers</a>
        </div>
        <div class="force-item">
          <strong>Nawadsugida Forces</strong><br>
          <a href="/api/soldiers/nawadsugida">View Soldiers</a>
        </div>
      </div>
    </div>
    
    <div class="card">
      <h3>🔧 Setup & Maintenance</h3>
      <div class="api-link">
        <a href="/api/setup-forces" target="_blank">⚙️ Setup Force Tables</a>
        <p>Creates database tables for all forces</p>
      </div>
      <div class="api-link">
        <a href="/api/migrate-data" target="_blank">🔄 Migrate Old Data</a>
        <p>Transfer data from old table to new system</p>
      </div>
      <div class="api-link">
        <a href="/api/migrate-fiat-to-gadidka" target="_blank">🔄 Migrate Fiat to Gadidka</a>
        <p>Update platoon names from Fiat to Gadidka</p>
      </div>
    </div>
    
    <div class="card">
      <h3>📊 Statistics</h3>
      <div class="api-link">
        <a href="/api/total-statistics" target="_blank">📈 Total Statistics</a>
        <p>Overview across all forces</p>
      </div>
      <div class="api-link">
        <a href="/api/check-soldiers" target="_blank">👥 Check Soldier Counts</a>
        <p>Count soldiers in all tables</p>
      </div>
    </div>
  </div>
  
  <script>
    // Check API health on load
    fetch('/api/health')
      .then(response => response.json())
      .then(data => {
        console.log('API Health:', data);
      })
      .catch(error => {
        console.log('API Health Check Failed:', error);
      });
  </script>
</body>
</html>
  `);
});

// ================== MULTI-FORCE SETUP ==================

// Available forces
const FORCES = {
  'statehouse': 'Jubaland Statehouse Forces',
  'police': 'Police Force',
  'darawish': 'Darawish Forces',
  'nawadsugida': 'Nawadsugida Forces'
};

// Force-specific table names
function getForceTableName(force) {
  return `${force}_soldiers`;
}

// ================== DATABASE MIGRATION: Fiat to Gadidka ==================

// Migration endpoint to move soldiers from Fiat to Gadidka
app.get('/api/migrate-fiat-to-gadidka', async (req, res) => {
  try {
    console.log('🚀 Starting migration of Fiat soldiers to Gadidka...');
    
    // Process each force table
    const migrationResults = {};
    
    for (const force of Object.keys(FORCES)) {
      const tableName = getForceTableName(force);
      
      try {
        // Check if table exists
        const tableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          );
        `, [tableName]);

        const tableExists = tableCheck.rows[0].exists;
        
        if (tableExists) {
          // Count Fiat soldiers before migration
          const countBefore = await pool.query(
            `SELECT COUNT(*) as count FROM ${tableName} WHERE horin_platoon = 'Fiat'`
          );
          
          const fiatCount = parseInt(countBefore.rows[0].count);
          
          if (fiatCount > 0) {
            // Migrate soldiers from Fiat to Gadidka
            await pool.query(`
              UPDATE ${tableName} 
              SET horin_platoon = 'Gadidka', 
                  updated_at = CURRENT_TIMESTAMP 
              WHERE horin_platoon = 'Fiat'
            `);
            
            // Count after migration
            const countAfter = await pool.query(
              `SELECT COUNT(*) as count FROM ${tableName} WHERE horin_platoon = 'Fiat'`
            );
            
            const remainingFiat = parseInt(countAfter.rows[0].count);
            
            migrationResults[force] = {
              success: true,
              migrated: fiatCount,
              remaining_fiat: remainingFiat,
              message: `Migrated ${fiatCount} soldiers from Fiat to Gadidka in ${FORCES[force]}`
            };
            
            console.log(`✅ ${FORCES[force]}: Migrated ${fiatCount} soldiers from Fiat to Gadidka`);
          } else {
            migrationResults[force] = {
              success: true,
              migrated: 0,
              message: `No Fiat soldiers found in ${FORCES[force]}`
            };
          }
        } else {
          migrationResults[force] = {
            success: false,
            message: `Table ${tableName} not found for ${FORCES[force]}`
          };
        }
      } catch (error) {
        migrationResults[force] = {
          success: false,
          error: error.message,
          message: `Error migrating ${FORCES[force]}: ${error.message}`
        };
      }
    }
    
    // Also check and migrate old soldiersRepository table for backward compatibility
    try {
      const oldTableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'soldiersrepository'
        );
      `);

      if (oldTableCheck.rows[0].exists) {
        const countBefore = await pool.query(
          `SELECT COUNT(*) as count FROM soldiersRepository WHERE horin_platoon = 'Fiat'`
        );
        
        const fiatCount = parseInt(countBefore.rows[0].count);
        
        if (fiatCount > 0) {
          await pool.query(`
            UPDATE soldiersRepository 
            SET horin_platoon = 'Gadidka', 
                updated_at = CURRENT_TIMESTAMP 
            WHERE horin_platoon = 'Fiat'
          `);
          
          migrationResults['soldiersrepository'] = {
            success: true,
            migrated: fiatCount,
            message: `Migrated ${fiatCount} soldiers from Fiat to Gadidka in old soldiersRepository table`
          };
          
          console.log(`✅ Old soldiersRepository: Migrated ${fiatCount} soldiers from Fiat to Gadidka`);
        }
      }
    } catch (oldTableError) {
      console.log('⚠️ Old table migration skipped:', oldTableError.message);
    }

    res.json({
      success: true,
      message: 'Fiat to Gadidka migration completed',
      results: migrationResults
    });
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================== DATABASE SETUP ENDPOINTS ==================

// 1. Setup all forces tables with data migration
app.get('/api/setup-forces', async (req, res) => {
  try {
    const forceKeys = Object.keys(FORCES);
    
    // First, check if old table exists
    const oldTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'soldiersrepository'
      );
    `);

    const oldTableExists = oldTableCheck.rows[0].exists;
    let migratedData = false;
    
    if (oldTableExists) {
      console.log('⚠️ Old table found. Will migrate data...');
      
      // Check if old table has data
      const oldDataCount = await pool.query('SELECT COUNT(*) as count FROM soldiersrepository');
      const hasOldData = parseInt(oldDataCount.rows[0].count) > 0;
      
      if (hasOldData) {
        console.log(`📦 Found ${oldDataCount.rows[0].count} records in old table to migrate`);
      }
    }
    
    for (const force of forceKeys) {
      const tableName = getForceTableName(force);
      
      // Check if new table exists
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        );
      `, [tableName]);

      const tableExists = tableCheck.rows[0].exists;

      if (!tableExists) {
        // Create new table for this force
        await pool.query(`
          CREATE TABLE ${tableName} (
            soldier_id VARCHAR(20) PRIMARY KEY,
            force_type VARCHAR(50) NOT NULL,
            full_names VARCHAR(255) NOT NULL,
            date_of_birth DATE NOT NULL,
            gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
            photo TEXT,
            fingerprint_data TEXT,
            rank_position VARCHAR(50),
            date_of_enlistment DATE NOT NULL,
            horin_platoon VARCHAR(50),
            horin_commander VARCHAR(255),
            net_salary DECIMAL(10,2),
            tel_number VARCHAR(15) UNIQUE,
            clan VARCHAR(100),
            guarantor_name VARCHAR(255),
            guarantor_phone VARCHAR(15),
            emergency_contact_name VARCHAR(255),
            emergency_contact_phone VARCHAR(15),
            home_address TEXT,
            blood_group VARCHAR(5) CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
            gun_number VARCHAR(50),
            status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Wounded', 'Discharged', 'Dead')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log(`✅ Created table for ${FORCES[force]}`);
        
        // If this is statehouse and old table exists, migrate data
        if (force === 'statehouse' && oldTableExists) {
          try {
            // Check if old table has gun_number column
            const columnCheck = await pool.query(`
              SELECT column_name 
              FROM information_schema.columns 
              WHERE table_name = 'soldiersrepository' AND column_name = 'gun_number'
            `);
            
            const gunColumnExists = columnCheck.rows.length > 0;
            
            if (gunColumnExists) {
              // Migrate all data with gun_number
              await pool.query(`
                INSERT INTO ${tableName} (
                  soldier_id, force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
                  rank_position, date_of_enlistment, horin_platoon, horin_commander,
                  net_salary, tel_number, clan, guarantor_name, guarantor_phone,
                  emergency_contact_name, emergency_contact_phone, home_address,
                  blood_group, gun_number, status, created_at, updated_at
                )
                SELECT 
                  soldier_id, 'statehouse' as force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
                  rank_position, date_of_enlistment, horin_platoon, horin_commander,
                  net_salary, tel_number, clan, guarantor_name, guarantor_phone,
                  emergency_contact_name, emergency_contact_phone, home_address,
                  blood_group, gun_number, status, created_at, updated_at
                FROM soldiersrepository
              `);
            } else {
              // Migrate data without gun_number column
              await pool.query(`
                INSERT INTO ${tableName} (
                  soldier_id, force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
                  rank_position, date_of_enlistment, horin_platoon, horin_commander,
                  net_salary, tel_number, clan, guarantor_name, guarantor_phone,
                  emergency_contact_name, emergency_contact_phone, home_address,
                  blood_group, gun_number, status, created_at, updated_at
                )
                SELECT 
                  soldier_id, 'statehouse' as force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
                  rank_position, date_of_enlistment, horin_platoon, horin_commander,
                  net_salary, tel_number, clan, guarantor_name, guarantor_phone,
                  emergency_contact_name, emergency_contact_phone, home_address,
                  blood_group, NULL as gun_number, status, created_at, updated_at
                FROM soldiersrepository
              `);
            }
            
            const migratedCount = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
            console.log(`✅ Migrated ${migratedCount.rows[0].count} records to ${FORCES[force]}`);
            migratedData = true;
            
          } catch (migrateError) {
            console.error('❌ Error migrating data:', migrateError.message);
          }
        }
      }
    }

    // Also check for backward compatibility - create soldiersRepository if it doesn't exist
    if (!oldTableExists) {
      await pool.query(`
        CREATE TABLE soldiersRepository (
          soldier_id VARCHAR(20) PRIMARY KEY,
          full_names VARCHAR(255) NOT NULL,
          date_of_birth DATE NOT NULL,
          gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
          photo TEXT,
          fingerprint_data TEXT,
          rank_position VARCHAR(50),
          date_of_enlistment DATE NOT NULL,
          horin_platoon VARCHAR(50) CHECK (horin_platoon IN ('Horin1', 'Horin2', 'Horin3', 'Horin4', 'Horin5', 'Horin6', 'Gadidka', 'Taliska', 'Fiat')),
          horin_commander VARCHAR(255),
          net_salary DECIMAL(10,2),
          tel_number VARCHAR(15) UNIQUE,
          clan VARCHAR(100),
          guarantor_name VARCHAR(255),
          guarantor_phone VARCHAR(15),
          emergency_contact_name VARCHAR(255),
          emergency_contact_phone VARCHAR(15),
          home_address TEXT,
          blood_group VARCHAR(5) CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
          gun_number VARCHAR(50),
          status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Wounded', 'Discharged', 'Dead')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Created backward compatibility table soldiersRepository');
    }

    res.json({
      success: true,
      message: 'All force tables setup completed',
      forces: FORCES,
      migrated_data: migratedData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 2. Get available forces
app.get('/api/forces', async (req, res) => {
  try {
    res.json({
      success: true,
      forces: FORCES
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================== FORCE-SPECIFIC ENDPOINTS ==================

// 3. Register new soldier to specific force (with backward compatibility)
app.post('/api/soldiers/:force', async (req, res) => {
  try {
    const { force } = req.params;
    const {
      full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, gun_number, status
    } = req.body;

    const tableName = getForceTableName(force);
    
    // Generate Soldier ID (Force-specific prefix)
    const countResult = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
    const count = parseInt(countResult.rows[0].count) + 1;
    
    // Force-specific ID prefixes
    const forcePrefixes = {
      'statehouse': 'CMJ',
      'police': 'POL',
      'darawish': 'DAR',
      'nawadsugida': 'NAW'
    };
    
    const prefix = forcePrefixes[force] || 'FRC';
    const soldier_id = `${prefix}${String(count).padStart(5, '0')}`;

    const query = `
      INSERT INTO ${tableName} (
        soldier_id, force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
        rank_position, date_of_enlistment, horin_platoon, horin_commander,
        net_salary, tel_number, clan, guarantor_name, guarantor_phone,
        emergency_contact_name, emergency_contact_phone, home_address,
        blood_group, gun_number, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *
    `;

    const values = [
      soldier_id, force, full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, gun_number || null, status || 'Active'
    ];

    const result = await pool.query(query, values);
    
    // Also save to old table for backward compatibility (only for statehouse)
    if (force === 'statehouse') {
      try {
        await pool.query(`
          INSERT INTO soldiersRepository (
            soldier_id, full_names, date_of_birth, gender, photo, fingerprint_data,
            rank_position, date_of_enlistment, horin_platoon, horin_commander,
            net_salary, tel_number, clan, guarantor_name, guarantor_phone,
            emergency_contact_name, emergency_contact_phone, home_address,
            blood_group, gun_number, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          ON CONFLICT (soldier_id) DO NOTHING
        `, [
          soldier_id, full_names, date_of_birth, gender, photo, fingerprint_data,
          rank_position, date_of_enlistment, horin_platoon, horin_commander,
          net_salary, tel_number, clan, guarantor_name, guarantor_phone,
          emergency_contact_name, emergency_contact_phone, home_address,
          blood_group, gun_number || null, status || 'Active'
        ]);
      } catch (backwardError) {
        console.log('⚠️ Backward compatibility insert failed:', backwardError.message);
      }
    }
    
    res.json({
      success: true,
      message: `Soldier registered successfully to ${FORCES[force]}`,
      soldier: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 4. Get all soldiers from specific force (with backward compatibility for statehouse) - FIXED VERSION
app.get('/api/soldiers/:force', async (req, res) => {
  try {
    const { force } = req.params;
    
    // Validate force parameter
    if (!FORCES[force]) {
      return res.status(400).json({
        success: false,
        error: `Invalid force: ${force}. Available forces: ${Object.keys(FORCES).join(', ')}`
      });
    }

    const tableName = getForceTableName(force);
    
    // Check if force table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = $1
      );
    `, [tableName]);

    const tableExists = tableCheck.rows[0].exists;

    if (!tableExists && force === 'statehouse') {
      // If statehouse table doesn't exist but old table does, use old table
      const oldTableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'soldiersrepository'
        );
      `);
      
      if (oldTableCheck.rows[0].exists) {
        try {
          // Use specific columns to avoid issues
          const result = await pool.query(`
            SELECT
              soldier_id,
              full_names,
              date_of_birth,
              gender,
              rank_position,
              date_of_enlistment,
              horin_platoon,
              horin_commander,
              net_salary,
              tel_number,
              clan,
              guarantor_name,
              guarantor_phone,
              emergency_contact_name,
              emergency_contact_phone,
              home_address,
              blood_group,
              gun_number,
              status,
              created_at,
              updated_at
            FROM soldiersRepository
            ORDER BY soldier_id
          `);
          
          // Add force_type to each soldier
          const soldiersWithForce = result.rows.map(soldier => ({
            ...soldier,
            force_type: 'statehouse'
          }));
          
          return res.json({
            success: true,
            force: FORCES[force],
            count: soldiersWithForce.length,
            soldiers: soldiersWithForce
          });
        } catch (oldTableError) {
          return res.status(500).json({
            success: false,
            error: `Error reading old table: ${oldTableError.message}`
          });
        }
      }
      
      return res.status(404).json({
        success: false,
        error: `Table ${tableName} not found for ${FORCES[force]}`
      });
    }

    if (!tableExists) {
      return res.status(404).json({
        success: false,
        error: `Table ${tableName} not found for ${FORCES[force]}`
      });
    }

    try {
      // Use specific columns instead of SELECT * to avoid issues
      const result = await pool.query(`
        SELECT
          soldier_id,
          force_type,
          full_names,
          date_of_birth,
          gender,
          photo,
          fingerprint_data,
          rank_position,
          date_of_enlistment,
          horin_platoon,
          horin_commander,
          net_salary,
          tel_number,
          clan,
          guarantor_name,
          guarantor_phone,
          emergency_contact_name,
          emergency_contact_phone,
          home_address,
          blood_group,
          gun_number,
          status,
          created_at,
          updated_at
        FROM ${tableName}
        ORDER BY soldier_id
      `);
      
      res.json({
        success: true,
        force: FORCES[force],
        count: result.rows.length,
        soldiers: result.rows
      });
    } catch (queryError) {
      console.error(`Error querying ${tableName}:`, queryError);
      
      // Try with fewer columns as fallback (REMOVED LIMIT 100)
      try {
        const simpleResult = await pool.query(`
          SELECT
            soldier_id,
            force_type,
            full_names,
            date_of_birth,
            gender
          FROM ${tableName}
          ORDER BY soldier_id
        `);
        
        res.json({
          success: true,
          force: FORCES[force],
          count: simpleResult.rows.length,
          soldiers: simpleResult.rows,
          note: 'Showing limited columns due to data issues'
        });
      } catch (simpleError) {
        res.status(500).json({
          success: false,
          error: `Database error: ${simpleError.message}`,
          hint: 'Check if table structure matches expected columns'
        });
      }
    }
  } catch (error) {
    console.error('Error in /api/soldiers/:force:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 5. Get single soldier by ID from specific force (with backward compatibility)
app.get('/api/soldiers/:force/:id', async (req, res) => {
  try {
    const { force, id } = req.params;
    const tableName = getForceTableName(force);
    
    let result;
    
    try {
      result = await pool.query(`SELECT * FROM ${tableName} WHERE soldier_id = $1`, [id]);
      
      if (result.rows.length === 0 && force === 'statehouse') {
        // Try old table for backward compatibility
        result = await pool.query('SELECT * FROM soldiersRepository WHERE soldier_id = $1', [id]);
        if (result.rows.length > 0) {
          // Add force_type for backward compatibility
          result.rows[0].force_type = 'statehouse';
        }
      }
    } catch (tableError) {
      // If table doesn't exist and force is statehouse, try old table
      if (force === 'statehouse') {
        result = await pool.query('SELECT * FROM soldiersRepository WHERE soldier_id = $1', [id]);
        if (result.rows.length > 0) {
          result.rows[0].force_type = 'statehouse';
        }
      }
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Soldier not found'
      });
    }

    res.json({
      success: true,
      soldier: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 6. Search soldiers in specific force (with backward compatibility)
app.get('/api/soldiers-search/:force', async (req, res) => {
  try {
    const { force } = req.params;
    const { query } = req.query;
    const tableName = getForceTableName(force);
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    let searchQuery;
    let params;
    
    try {
      searchQuery = `
        SELECT * FROM ${tableName} 
        WHERE soldier_id ILIKE $1 OR full_names ILIKE $1
        ORDER BY soldier_id
      `;
      params = [`%${query}%`];
      
      const result = await pool.query(searchQuery, params);
      return res.json({
        success: true,
        soldiers: result.rows
      });
    } catch (tableError) {
      // If table doesn't exist and force is statehouse, search old table
      if (force === 'statehouse') {
        searchQuery = `
          SELECT * FROM soldiersRepository 
          WHERE soldier_id ILIKE $1 OR full_names ILIKE $1
          ORDER BY soldier_id
        `;
        const result = await pool.query(searchQuery, [`%${query}%`]);
        
        // Add force_type for backward compatibility
        const soldiersWithForce = result.rows.map(soldier => ({
          ...soldier,
          force_type: 'statehouse'
        }));
        
        return res.json({
          success: true,
          soldiers: soldiersWithForce
        });
      }
      throw tableError;
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 7. Update soldier in specific force (with backward compatibility)
app.put('/api/soldiers/:force/:id', async (req, res) => {
  try {
    const { force, id } = req.params;
    const {
      full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, gun_number, status
    } = req.body;

    const tableName = getForceTableName(force);
    
    const query = `
      UPDATE ${tableName} SET
        full_names = $1, date_of_birth = $2, gender = $3, photo = $4, fingerprint_data = $5,
        rank_position = $6, date_of_enlistment = $7, horin_platoon = $8, horin_commander = $9,
        net_salary = $10, tel_number = $11, clan = $12, guarantor_name = $13, guarantor_phone = $14,
        emergency_contact_name = $15, emergency_contact_phone = $16, home_address = $17,
        blood_group = $18, gun_number = $19, status = $20, updated_at = CURRENT_TIMESTAMP
      WHERE soldier_id = $21
      RETURNING *
    `;

    const values = [
      full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, gun_number || null, status, id
    ];

    let result;
    
    try {
      result = await pool.query(query, values);
      
      // Also update old table for backward compatibility (only for statehouse)
      if (force === 'statehouse' && result.rows.length > 0) {
        try {
          await pool.query(`
            UPDATE soldiersRepository SET
              full_names = $1, date_of_birth = $2, gender = $3, photo = $4, fingerprint_data = $5,
              rank_position = $6, date_of_enlistment = $7, horin_platoon = $8, horin_commander = $9,
              net_salary = $10, tel_number = $11, clan = $12, guarantor_name = $13, guarantor_phone = $14,
              emergency_contact_name = $15, emergency_contact_phone = $16, home_address = $17,
              blood_group = $18, gun_number = $19, status = $20, updated_at = CURRENT_TIMESTAMP
            WHERE soldier_id = $21
          `, values);
        } catch (backwardError) {
          console.log('⚠️ Backward compatibility update failed:', backwardError.message);
        }
      }
    } catch (tableError) {
      // If table doesn't exist and force is statehouse, update old table
      if (force === 'statehouse') {
        const oldQuery = `
          UPDATE soldiersRepository SET
            full_names = $1, date_of_birth = $2, gender = $3, photo = $4, fingerprint_data = $5,
            rank_position = $6, date_of_enlistment = $7, horin_platoon = $8, horin_commander = $9,
            net_salary = $10, tel_number = $11, clan = $12, guarantor_name = $13, guarantor_phone = $14,
            emergency_contact_name = $15, emergency_contact_phone = $16, home_address = $17,
            blood_group = $18, gun_number = $19, status = $20, updated_at = CURRENT_TIMESTAMP
            WHERE soldier_id = $21
          RETURNING *
        `;
        result = await pool.query(oldQuery, values);
        
        // Add force_type for backward compatibility
        if (result.rows.length > 0) {
          result.rows[0].force_type = 'statehouse';
        }
      } else {
        throw tableError;
      }
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Soldier not found'
      });
    }

    res.json({
      success: true,
      message: 'Soldier updated successfully',
      soldier: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 8. Delete soldier from specific force (with backward compatibility)
app.delete('/api/soldiers/:force/:id', async (req, res) => {
  try {
    const { force, id } = req.params;
    const tableName = getForceTableName(force);
    
    let result;
    
    try {
      result = await pool.query(`DELETE FROM ${tableName} WHERE soldier_id = $1 RETURNING *`, [id]);
      
      // Also delete from old table for backward compatibility (only for statehouse)
      if (force === 'statehouse' && result.rows.length > 0) {
        try {
          await pool.query('DELETE FROM soldiersRepository WHERE soldier_id = $1', [id]);
        } catch (backwardError) {
          console.log('⚠️ Backward compatibility delete failed:', backwardError.message);
        }
      }
    } catch (tableError) {
      // If table doesn't exist and force is statehouse, delete from old table
      if (force === 'statehouse') {
        result = await pool.query('DELETE FROM soldiersRepository WHERE soldier_id = $1 RETURNING *', [id]);
        
        // Add force_type for backward compatibility
        if (result.rows.length > 0) {
          result.rows[0].force_type = 'statehouse';
        }
      } else {
        throw tableError;
      }
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Soldier not found'
      });
    }

    res.json({
      success: true,
      message: 'Soldier deleted successfully',
      soldier: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 9. Get soldiers data for Excel-like table view from specific force (with backward compatibility)
app.get('/api/soldiers-table/:force', async (req, res) => {
  try {
    const { force } = req.params;
    const tableName = getForceTableName(force);
    
    let result;
    
    try {
      result = await pool.query(`
        SELECT 
          soldier_id,
          full_names,
          date_of_birth,
          gender,
          rank_position,
          date_of_enlistment,
          horin_platoon,
          horin_commander,
          gun_number,
          net_salary,
          tel_number,
          clan,
          guarantor_name,
          guarantor_phone,
          emergency_contact_name,
          emergency_contact_phone,
          blood_group,
          status
        FROM ${tableName} 
        ORDER BY soldier_id
      `);
    } catch (tableError) {
      // If table doesn't exist and force is statehouse, use old table
      if (force === 'statehouse') {
        result = await pool.query(`
          SELECT 
            soldier_id,
            full_names,
            date_of_birth,
            gender,
            rank_position,
            date_of_enlistment,
            horin_platoon,
            horin_commander,
            gun_number,
            net_salary,
            tel_number,
            clan,
            guarantor_name,
            guarantor_phone,
            emergency_contact_name,
            emergency_contact_phone,
            blood_group,
            status
          FROM soldiersRepository 
          ORDER BY soldier_id
        `);
      } else {
        throw tableError;
      }
    }
    
    res.json({
      success: true,
      force: FORCES[force],
      soldiers: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 10. Enhanced Executive Dashboard for specific force with ALL soldiers count
app.get('/api/executive-dashboard/:force', async (req, res) => {
  try {
    const { force } = req.params;
    const tableName = getForceTableName(force);
    
    // Determine which table to use
    let useTable = tableName;
    
    try {
      // Test if force table exists
      await pool.query(`SELECT 1 FROM ${tableName} LIMIT 1`);
    } catch (tableError) {
      // If table doesn't exist and force is statehouse, use old table
      if (force === 'statehouse') {
        useTable = 'soldiersRepository';
      } else {
        throw tableError;
      }
    }
    
    // Get total soldiers count (ALL statuses - Active, Wounded, Discharged, Dead)
    const totalResult = await pool.query(`SELECT COUNT(*) as total_count FROM ${useTable}`);
    const totalSoldiers = parseInt(totalResult.rows[0].total_count) || 0;

    // Get platoon distribution (ALL soldiers)
    const platoonResult = await pool.query(`
      SELECT 
        horin_platoon,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY horin_platoon
      ORDER BY 
        CASE horin_platoon
          WHEN 'Fiat' THEN 1
          WHEN 'Gadidka' THEN 2
          WHEN 'Horin1' THEN 3
          WHEN 'Horin2' THEN 4
          WHEN 'Horin3' THEN 5
          WHEN 'Horin4' THEN 6
          WHEN 'Horin5' THEN 7
          WHEN 'Horin6' THEN 8
          WHEN 'Taliska' THEN 9
          ELSE 10
        END
    `);

    // Get rank distribution (ALL soldiers)
    const rankResult = await pool.query(`
      SELECT 
        rank_position,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY rank_position
      ORDER BY 
        CASE rank_position
          WHEN 'Askari' THEN 1
          WHEN 'BKM/Sewenle' THEN 2
          WHEN 'Taliye Unug' THEN 3
          WHEN 'Taliye Koox' THEN 4
          WHEN 'Taliye Horin' THEN 5
          WHEN 'Abandule' THEN 6
          WHEN 'Taliye Guuto' THEN 7
          ELSE 8
        END
    `);

    // Get gender distribution (ALL soldiers)
    const genderResult = await pool.query(`
      SELECT 
        gender,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY gender
      ORDER BY gender
    `);

    // Get blood group distribution (ALL soldiers)
    const bloodResult = await pool.query(`
      SELECT 
        CASE 
          WHEN blood_group IS NULL THEN 'Not Specified'
          ELSE blood_group 
        END as blood_group,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY blood_group
      ORDER BY blood_group
    `);

    // Get age distribution (ALL soldiers)
    const ageResult = await pool.query(`
      SELECT 
        age_group,
        COUNT(*) as count
      FROM (
        SELECT 
          CASE
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) < 20 THEN 'Under 20'
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 20 AND 24 THEN '20-24'
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 25 AND 29 THEN '25-29'
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 30 AND 34 THEN '30-34'
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 35 AND 39 THEN '35-39'
            ELSE '40+'
          END as age_group
        FROM ${useTable}
      ) as age_data
      GROUP BY age_group
      ORDER BY age_group
    `);

    // Get status distribution
    const statusResult = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY status
      ORDER BY status
    `);

    // Get total monthly payroll (Active soldiers only)
    const payrollResult = await pool.query(`SELECT COALESCE(SUM(net_salary), 0) as total_payroll FROM ${useTable} WHERE status = 'Active'`);
    const monthlyPayroll = parseFloat(payrollResult.rows[0].total_payroll) || 0;

    // Format distributions
    const platoonDistribution = {};
    platoonResult.rows.forEach(row => {
      platoonDistribution[row.horin_platoon] = parseInt(row.count);
    });

    const rankDistribution = {};
    rankResult.rows.forEach(row => {
      rankDistribution[row.rank_position] = parseInt(row.count);
    });

    const genderDistribution = {};
    genderResult.rows.forEach(row => {
      genderDistribution[row.gender] = parseInt(row.count);
    });

    const bloodGroupDistribution = {};
    bloodResult.rows.forEach(row => {
      bloodGroupDistribution[row.blood_group] = parseInt(row.count);
    });

    const ageDistribution = {};
    ageResult.rows.forEach(row => {
      ageDistribution[row.age_group] = parseInt(row.count);
    });

    const statusDistribution = {};
    statusResult.rows.forEach(row => {
      statusDistribution[row.status] = parseInt(row.count);
    });

    // Get payroll by rank for Active soldiers
    const payrollByRankResult = await pool.query(`
      SELECT 
        rank_position,
        COUNT(*) as count,
        COALESCE(AVG(net_salary), 0) as avg_salary,
        COALESCE(SUM(net_salary), 0) as total_payroll
      FROM ${useTable}
      WHERE status = 'Active'
      GROUP BY rank_position
      ORDER BY 
        CASE rank_position
          WHEN 'Askari' THEN 1
          WHEN 'BKM/Sewenle' THEN 2
          WHEN 'Taliye Unug' THEN 3
          WHEN 'Taliye Koox' THEN 4
          WHEN 'Taliye Horin' THEN 5
          WHEN 'Abandule' THEN 6
          WHEN 'Taliye Guuto' THEN 7
          ELSE 8
        END
    `);

    const payrollByRank = {};
    payrollByRankResult.rows.forEach(row => {
      payrollByRank[row.rank_position] = {
        count: parseInt(row.count),
        avg_salary: parseFloat(row.avg_salary),
        total_payroll: parseFloat(row.total_payroll)
      };
    });

    res.json({
      success: true,
      force: FORCES[force],
      dashboard: {
        total_soldiers: totalSoldiers,
        monthly_payroll: monthlyPayroll,
        platoon_distribution: platoonDistribution,
        rank_distribution: rankDistribution,
        gender_distribution: genderDistribution,
        blood_group_distribution: bloodGroupDistribution,
        age_distribution: ageDistribution,
        status_distribution: statusDistribution,
        payroll_by_rank: payrollByRank
      }
    });
  } catch (error) {
    console.error('Error generating executive dashboard:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 11. Summary Report for specific force (with backward compatibility)
app.get('/api/summary-report/:force', async (req, res) => {
  try {
    const { force } = req.params;
    const tableName = getForceTableName(force);
    
    // Determine which table to use
    let useTable = tableName;
    
    try {
      await pool.query(`SELECT 1 FROM ${tableName} LIMIT 1`);
    } catch (tableError) {
      if (force === 'statehouse') {
        useTable = 'soldiersRepository';
      } else {
        throw tableError;
      }
    }
    
    // Get total count of all soldiers
    const totalResult = await pool.query(`SELECT COUNT(*) as total_count FROM ${useTable}`);
    const totalSoldiers = parseInt(totalResult.rows[0].total_count);

    // Get counts by horin/platoon
    const horinCounts = await pool.query(`
      SELECT 
        horin_platoon,
        COUNT(*) as count
      FROM ${useTable} 
      GROUP BY horin_platoon
      ORDER BY 
        CASE horin_platoon
          WHEN 'Fiat' THEN 1
          WHEN 'Gadidka' THEN 2
          WHEN 'Horin1' THEN 3
          WHEN 'Horin2' THEN 4
          WHEN 'Horin3' THEN 5
          WHEN 'Horin4' THEN 6
          WHEN 'Horin5' THEN 7
          WHEN 'Horin6' THEN 8
          WHEN 'Taliska' THEN 9
          ELSE 10
        END
    `);

    // Get counts by rank/position
    const rankCounts = await pool.query(`
      SELECT 
        rank_position,
        COUNT(*) as count
      FROM ${useTable} 
      GROUP BY rank_position
      ORDER BY 
        CASE rank_position
          WHEN 'Askari' THEN 1
          WHEN 'BKM/Sewenle' THEN 2
          WHEN 'Taliye Unug' THEN 3
          WHEN 'Taliye Koox' THEN 4
          WHEN 'Taliye Horin' THEN 5
          WHEN 'Abandule' THEN 6
          WHEN 'Taliye Guuto' THEN 7
          ELSE 8
        END
    `);

    // Get total net salary
    const salaryResult = await pool.query(`SELECT SUM(net_salary) as total_salary FROM ${useTable}`);
    const totalNetSalary = parseFloat(salaryResult.rows[0].total_salary) || 0;

    // Convert results to object format
    const horinData = {};
    horinCounts.rows.forEach(row => {
      const key = row.horin_platoon.toLowerCase();
      horinData[key] = parseInt(row.count);
    });

    const rankData = {};
    rankCounts.rows.forEach(row => {
      const key = row.rank_position.toLowerCase().replace(/\/|\s+/g, '_');
      rankData[key] = parseInt(row.count);
    });

    const summary = {
      fiat: horinData.fiat || 0,
      gadidka: horinData.gadidka || 0,
      horin1: horinData.horin1 || 0,
      horin2: horinData.horin2 || 0,
      horin3: horinData.horin3 || 0,
      horin4: horinData.horin4 || 0,
      horin5: horinData.horin5 || 0,
      horin6: horinData.horin6 || 0,
      taliska: horinData.taliska || 0,
      
      askari: rankData.askari || 0,
      bkm_sewenle: rankData.bkm_sewenle || 0,
      taliye_unug: rankData.taliye_unug || 0,
      taliye_koox: rankData.taliye_koox || 0,
      taliye_horin: rankData.taliye_horin || 0,
      abandule: rankData.abandule || 0,
      taliye_guuto: rankData.taliye_guuto || 0,
      
      total_soldiers: totalSoldiers,
      total_net_salary: totalNetSalary
    };

    res.json({
      success: true,
      force: FORCES[force],
      summary: summary
    });
  } catch (error) {
    console.error('Error generating summary report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 12. Get total statistics across all forces
app.get('/api/total-statistics', async (req, res) => {
  try {
    const forceKeys = Object.keys(FORCES);
    const totalStats = {
      total_soldiers: 0,
      forces: {}
    };

    for (const force of forceKeys) {
      const tableName = getForceTableName(force);
      
      try {
        // Get counts for this force (ALL soldiers)
        const totalResult = await pool.query(`SELECT COUNT(*) as total_count FROM ${tableName}`);
        
        totalStats.forces[force] = {
          name: FORCES[force],
          total: parseInt(totalResult.rows[0].total_count)
        };
        
        totalStats.total_soldiers += parseInt(totalResult.rows[0].total_count);
      } catch (tableError) {
        // If table doesn't exist and force is statehouse, check old table
        if (force === 'statehouse') {
          try {
            const totalResult = await pool.query('SELECT COUNT(*) as total_count FROM soldiersRepository');
            
            totalStats.forces[force] = {
              name: FORCES[force],
              total: parseInt(totalResult.rows[0].total_count)
            };
            
            totalStats.total_soldiers += parseInt(totalResult.rows[0].total_count);
          } catch (oldTableError) {
            totalStats.forces[force] = {
              name: FORCES[force],
              total: 0
            };
          }
        } else {
          totalStats.forces[force] = {
            name: FORCES[force],
            total: 0
          };
        }
      }
    }

    res.json({
      success: true,
      statistics: totalStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 13. MIGRATION ENDPOINT: Transfer data from old table to new force tables
app.get('/api/migrate-data', async (req, res) => {
  try {
    // Check if old table exists
    const oldTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'soldiersrepository'
      );
    `);

    if (!oldTableCheck.rows[0].exists) {
      return res.json({
        success: false,
        error: 'Old soldiersRepository table not found'
      });
    }

    // Check if statehouse table exists
    const statehouseTable = getForceTableName('statehouse');
    const newTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = $1
      );
    `, [statehouseTable]);

    if (!newTableCheck.rows[0].exists) {
      return res.json({
        success: false,
        error: `New table ${statehouseTable} not found. Run /api/setup-forces first.`
      });
    }

    // Check if migration already done
    const newCountResult = await pool.query(`SELECT COUNT(*) as count FROM ${statehouseTable}`);
    const newCount = parseInt(newCountResult.rows[0].count);
    
    if (newCount > 0) {
      return res.json({
        success: false,
        error: 'Migration already done. New table already has data.'
      });
    }

    // Get count from old table
    const oldCountResult = await pool.query('SELECT COUNT(*) as count FROM soldiersrepository');
    const oldCount = parseInt(oldCountResult.rows[0].count);
    
    if (oldCount === 0) {
      return res.json({
        success: false,
        error: 'No data to migrate from old table'
      });
    }

    console.log(`Starting migration of ${oldCount} records...`);
    
    // Migrate data
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'soldiersrepository' AND column_name = 'gun_number'
    `);
    
    const gunColumnExists = columnCheck.rows.length > 0;
    
    if (gunColumnExists) {
      await pool.query(`
        INSERT INTO ${statehouseTable} (
          soldier_id, force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
          rank_position, date_of_enlistment, horin_platoon, horin_commander,
          net_salary, tel_number, clan, guarantor_name, guarantor_phone,
          emergency_contact_name, emergency_contact_phone, home_address,
          blood_group, gun_number, status, created_at, updated_at
        )
        SELECT 
          soldier_id, 'statehouse' as force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
          rank_position, date_of_enlistment, horin_platoon, horin_commander,
          net_salary, tel_number, clan, guarantor_name, guarantor_phone,
          emergency_contact_name, emergency_contact_phone, home_address,
          blood_group, gun_number, status, created_at, updated_at
        FROM soldiersrepository
      `);
    } else {
      await pool.query(`
        INSERT INTO ${statehouseTable} (
          soldier_id, force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
          rank_position, date_of_enlistment, horin_platoon, horin_commander,
          net_salary, tel_number, clan, guarantor_name, guarantor_phone,
          emergency_contact_name, emergency_contact_phone, home_address,
          blood_group, gun_number, status, created_at, updated_at
        )
        SELECT 
          soldier_id, 'statehouse' as force_type, full_names, date_of_birth, gender, photo, fingerprint_data,
          rank_position, date_of_enlistment, horin_platoon, horin_commander,
          net_salary, tel_number, clan, guarantor_name, guarantor_phone,
          emergency_contact_name, emergency_contact_phone, home_address,
          blood_group, NULL as gun_number, status, created_at, updated_at
        FROM soldiersrepository
      `);
    }

    const migratedCount = await pool.query(`SELECT COUNT(*) as count FROM ${statehouseTable}`);
    
    res.json({
      success: true,
      message: `Successfully migrated ${migratedCount.rows[0].count} records from old table to ${statehouseTable}`,
      migrated_count: migratedCount.rows[0].count
    });
    
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================== BACKWARD COMPATIBILITY ENDPOINTS ==================

// These endpoints maintain compatibility with the old frontend

// Old endpoint: Get all soldiers
app.get('/api/soldiers', async (req, res) => {
  try {
    // Check new table first, then old table
    const statehouseTable = getForceTableName('statehouse');
    
    try {
      const result = await pool.query(`SELECT * FROM ${statehouseTable} ORDER BY soldier_id`);
      return res.json({
        success: true,
        soldiers: result.rows
      });
    } catch (newTableError) {
      // If new table doesn't exist, use old table
      const result = await pool.query('SELECT * FROM soldiersRepository ORDER BY soldier_id');
      return res.json({
        success: true,
        soldiers: result.rows
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Old endpoint: Search soldiers
app.get('/api/soldiers-search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    // Try new table first
    const statehouseTable = getForceTableName('statehouse');
    
    try {
      const searchQuery = `
        SELECT * FROM ${statehouseTable} 
        WHERE soldier_id ILIKE $1 OR full_names ILIKE $1
        ORDER BY soldier_id
      `;
      
      const result = await pool.query(searchQuery, [`%${query}%`]);
      return res.json({
        success: true,
        soldiers: result.rows
      });
    } catch (newTableError) {
      // Use old table
      const searchQuery = `
        SELECT * FROM soldiersRepository 
        WHERE soldier_id ILIKE $1 OR full_names ILIKE $1
        ORDER BY soldier_id
      `;
      
      const result = await pool.query(searchQuery, [`%${query}%`]);
      return res.json({
        success: true,
        soldiers: result.rows
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Old endpoint: Get soldiers table
app.get('/api/soldiers-table', async (req, res) => {
  try {
    const statehouseTable = getForceTableName('statehouse');
    
    try {
      const result = await pool.query(`
        SELECT 
          soldier_id,
          full_names,
          date_of_birth,
          gender,
          rank_position,
          date_of_enlistment,
          horin_platoon,
          horin_commander,
          gun_number,
          net_salary,
          tel_number,
          clan,
          guarantor_name,
          guarantor_phone,
          emergency_contact_name,
          emergency_contact_phone,
          blood_group,
          status
        FROM ${statehouseTable} 
        ORDER BY soldier_id
      `);
      
      return res.json({
        success: true,
        soldiers: result.rows
      });
    } catch (newTableError) {
      const result = await pool.query(`
        SELECT 
          soldier_id,
          full_names,
          date_of_birth,
          gender,
          rank_position,
          date_of_enlistment,
          horin_platoon,
          horin_commander,
          gun_number,
          net_salary,
          tel_number,
          clan,
          guarantor_name,
          guarantor_phone,
          emergency_contact_name,
          emergency_contact_phone,
          blood_group,
          status
        FROM soldiersRepository 
        ORDER BY soldier_id
      `);
      
      return res.json({
        success: true,
        soldiers: result.rows
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Old endpoint: Executive dashboard
app.get('/api/executive-dashboard', async (req, res) => {
  try {
    const statehouseTable = getForceTableName('statehouse');
    let useTable = statehouseTable;
    
    try {
      await pool.query(`SELECT 1 FROM ${statehouseTable} LIMIT 1`);
    } catch (tableError) {
      useTable = 'soldiersRepository';
    }
    
    // Get total soldiers count (ALL statuses)
    const totalResult = await pool.query(`SELECT COUNT(*) as total_count FROM ${useTable}`);
    const totalSoldiers = parseInt(totalResult.rows[0].total_count) || 0;

    // Get platoon distribution
    const platoonResult = await pool.query(`
      SELECT 
        horin_platoon,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY horin_platoon
      ORDER BY 
        CASE horin_platoon
          WHEN 'Fiat' THEN 1
          WHEN 'Gadidka' THEN 2
          WHEN 'Horin1' THEN 3
          WHEN 'Horin2' THEN 4
          WHEN 'Horin3' THEN 5
          WHEN 'Horin4' THEN 6
          WHEN 'Horin5' THEN 7
          WHEN 'Horin6' THEN 8
          WHEN 'Taliska' THEN 9
          ELSE 10
        END
    `);

    // Get rank distribution
    const rankResult = await pool.query(`
      SELECT 
        rank_position,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY rank_position
      ORDER BY 
        CASE rank_position
          WHEN 'Askari' THEN 1
          WHEN 'BKM/Sewenle' THEN 2
          WHEN 'Taliye Unug' THEN 3
          WHEN 'Taliye Koox' THEN 4
          WHEN 'Taliye Horin' THEN 5
          WHEN 'Abandule' THEN 6
          WHEN 'Taliye Guuto' THEN 7
          ELSE 8
        END
    `);

    // Get gender distribution
    const genderResult = await pool.query(`
      SELECT 
        gender,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY gender
      ORDER BY gender
    `);

    // Get blood group distribution
    const bloodResult = await pool.query(`
      SELECT 
        CASE 
          WHEN blood_group IS NULL THEN 'Not Specified'
          ELSE blood_group 
        END as blood_group,
        COUNT(*) as count
      FROM ${useTable}
      GROUP BY blood_group
      ORDER BY 
        CASE 
          WHEN blood_group = 'O+' THEN 1
          WHEN blood_group = 'A+' THEN 2
          WHEN blood_group = 'B+' THEN 3
          WHEN blood_group = 'A-' THEN 4
          WHEN blood_group = 'AB+' THEN 5
          WHEN blood_group = 'O-' THEN 6
          WHEN blood_group = 'B-' THEN 7
          WHEN blood_group IS NULL THEN 8
          ELSE 9
        END
    `);

    // Get age distribution
    const ageResult = await pool.query(`
      SELECT 
        age_group,
        COUNT(*) as count
      FROM (
        SELECT 
          CASE
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) < 20 THEN 'Under 20'
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 20 AND 24 THEN '20-24'
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 25 AND 29 THEN '25-29'
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 30 AND 34 THEN '30-34'
            WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 35 AND 39 THEN '35-39'
            ELSE '40+'
          END as age_group
        FROM ${useTable}
      ) as age_data
      GROUP BY age_group
      ORDER BY 
        CASE age_group
          WHEN 'Under 20' THEN 1
          WHEN '20-24' THEN 2
          WHEN '25-29' THEN 3
          WHEN '30-34' THEN 4
          WHEN '35-39' THEN 5
          WHEN '40+' THEN 6
          ELSE 7
        END
    `);

    // Get total monthly payroll
    const payrollResult = await pool.query(`SELECT COALESCE(SUM(net_salary), 0) as total_payroll FROM ${useTable} WHERE status = 'Active'`);
    const monthlyPayroll = parseFloat(payrollResult.rows[0].total_payroll) || 0;

    // Format platoon distribution with default values
    const defaultPlatoons = ['Fiat', 'Gadidka', 'Horin1', 'Horin2', 'Horin3', 'Horin4', 'Horin5', 'Horin6', 'Taliska'];
    const platoonDistribution = {};
    defaultPlatoons.forEach(platoon => {
      platoonDistribution[platoon] = 0;
    });
    
    platoonResult.rows.forEach(row => {
      platoonDistribution[row.horin_platoon] = parseInt(row.count);
    });

    // Format rank distribution with default values
    const defaultRanks = ['Askari', 'BKM/Sewenle', 'Taliye Unug', 'Taliye Koox', 'Taliye Horin', 'Abandule', 'Taliye Guuto'];
    const rankDistribution = {};
    defaultRanks.forEach(rank => {
      rankDistribution[rank] = 0;
    });
    
    rankResult.rows.forEach(row => {
      rankDistribution[row.rank_position] = parseInt(row.count);
    });

    // Format gender distribution with default values
    const defaultGenders = ['Male', 'Female'];
    const genderDistribution = {};
    defaultGenders.forEach(gender => {
      genderDistribution[gender] = 0;
    });
    
    genderResult.rows.forEach(row => {
      genderDistribution[row.gender] = parseInt(row.count);
    });

    // Format blood group distribution with default values
    const defaultBloodGroups = ['O+', 'A+', 'B+', 'A-', 'AB+', 'O-', 'B-', 'Not Specified'];
    const bloodGroupDistribution = {};
    defaultBloodGroups.forEach(bg => {
      bloodGroupDistribution[bg] = 0;
    });
    
    bloodResult.rows.forEach(row => {
      bloodGroupDistribution[row.blood_group] = parseInt(row.count);
    });

    // Format age distribution with default values
    const defaultAgeGroups = ['Under 20', '20-24', '25-29', '30-34', '35-39', '40+'];
    const ageDistribution = {};
    defaultAgeGroups.forEach(ageGroup => {
      ageDistribution[ageGroup] = 0;
    });
    
    ageResult.rows.forEach(row => {
      ageDistribution[row.age_group] = parseInt(row.count);
    });

    res.json({
      success: true,
      dashboard: {
        total_soldiers: totalSoldiers,
        monthly_payroll: monthlyPayroll,
        platoon_distribution: platoonDistribution,
        rank_distribution: rankDistribution,
        gender_distribution: genderDistribution,
        blood_group_distribution: bloodGroupDistribution,
        age_distribution: ageDistribution
      }
    });
  } catch (error) {
    console.error('Error generating executive dashboard:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================== BASIC ENDPOINTS ==================

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    res.json({ 
      status: 'OK', 
      database: 'connected',
      timestamp: result.rows[0].current_time
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

app.get('/api', (req, res) => {
  res.json({ 
    message: 'Jubaland Multi-Forces Database System - Railway Version',
    available_forces: FORCES,
    endpoints: {
      debug: {
        test_db: '/api/test-db (test database connection)',
        check_soldiers: '/api/check-soldiers (check soldier counts)',
        env: '/api/env (view environment variables)',
        soldiers_count: '/api/soldiers-count/:force (get specific force count)',
        debug_files: '/debug-files (check file system)'
      },
      setup: '/api/setup-forces (creates tables for all forces)',
      migrate_fiat_gadidka: '/api/migrate-fiat-to-gadidka (migrate soldiers from Fiat to Gadidka)',
      migrate: '/api/migrate-data (migrate old data to new system)',
      forces: '/api/forces (get available forces)',
      soldiers: {
        create: 'POST /api/soldiers/:force',
        getAll: 'GET /api/soldiers/:force',
        getOne: 'GET /api/soldiers/:force/:id',
        update: 'PUT /api/soldiers/:force/:id',
        delete: 'DELETE /api/soldiers/:force/:id',
        search: 'GET /api/soldiers-search/:force?query=',
        table: 'GET /api/soldiers-table/:force',
        summary: 'GET /api/summary-report/:force',
        dashboard: 'GET /api/executive-dashboard/:force'
      },
      // Backward compatibility
      backward_compat: {
        getAll: 'GET /api/soldiers',
        search: 'GET /api/soldiers-search',
        table: 'GET /api/soldiers-table',
        dashboard: 'GET /api/executive-dashboard'
      },
      statistics: '/api/total-statistics',
      health: '/api/health'
    }
  });
});

// Serve HTML for all non-API routes (MUST BE LAST)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Jubaland Multi-Forces Database running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔧 API: http://localhost:${PORT}/api`);
  console.log(`🎖️ Available Forces:`);
  Object.entries(FORCES).forEach(([key, name]) => {
    console.log(`   • ${key}: ${name}`);
  });
  console.log(`\n📋 IMPORTANT: Run these setup steps:`);
  console.log(`   1. http://localhost:${PORT}/api/setup-forces (creates tables)`);
  console.log(`   2. http://localhost:${PORT}/api/migrate-data (migrates old data)`);
  console.log(`   3. http://localhost:${PORT}/api/migrate-fiat-to-gadidka (migrate Fiat soldiers to Gadidka)`);
  console.log(`\n🔍 Debug endpoints:`);
  console.log(`   • /api/test-db (test database connection)`);
  console.log(`   • /api/check-soldiers (check soldier counts)`);
  console.log(`   • /debug-files (check file system)`);
});

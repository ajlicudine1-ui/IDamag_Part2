const mysql = require('mysql2/promise');
require('dotenv').config();

const initDB = async () => {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    console.log(`Checking if database "${process.env.DB_NAME}" exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\`;`);
    console.log(`Database "${process.env.DB_NAME}" is ready.`);
    
    await connection.end();
    
    // Now use Sequelize to sync and seed
    const { sequelize, Office, Division, User, Report } = require('../models/index');
    await sequelize.sync({ alter: true });
    console.log('Tables synchronized.');

    // Seed Initial Offices
    const officesData = [
      { name: 'Administrative and Finance Division', acronym: 'AFD' },
      { name: 'Field Operations Division', acronym: 'FOD' },
      { name: 'Planning, Monitoring & Evaluation Division', acronym: 'PMED' },
      { name: 'Agribusiness and Marketing Assistance Division', acronym: 'AMAD' },
      { name: 'Integrated Laboratories Division', acronym: 'ILD' },
      { name: 'Regional Agricultural Engineering Division', acronym: 'RAED' },
      { name: 'Regulatory Division', acronym: 'Regulatory' },
      { name: 'Research Division', acronym: 'Research' },
      { name: 'Philippine Rural Development Project', acronym: 'PRDP' }
    ];

    for (const officeData of officesData) {
      const [office, created] = await Office.findOrCreate({ where: { name: officeData.name }, defaults: { acronym: officeData.acronym } });
      if (created) {
        console.log(`Created Office: ${office.name} (${office.acronym})`);
      }
    }

    // Seed IMS Division in PMED (Office ID 3)
    const pmed = await Office.findOne({ where: { acronym: 'PMED' } });
    if (pmed) {
        const [ims, created] = await Division.findOrCreate({ 
            where: { name: 'IMS', officeId: pmed.id } 
        });
        if (created) {
            console.log('Created IMS Division in PMED.');
            
            // Create a default user for IMS
            await User.findOrCreate({
                where: { email: 'ims.pmed@da.gov.ph' },
                defaults: {
                    name: 'IMS Staff',
                    password: 'password123',
                    role: 'Staff',
                    officeId: pmed.id,
                    divisionId: ims.id
                }
            });
            console.log('Created default IMS Staff account.');

            // Seed a sample Power BI Report for IMS
            await Report.findOrCreate({
                where: { title: 'Sample Production Dashboard' },
                defaults: {
                    reportId: 'eyJrIjoiYzcyOTkxMDctMGFlMS00YzMxLWJlZTktMjI2MzI3NzY5NTgwIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ%3D%3D',
                    description: 'Automated sample report demonstrating secure Power BI integration.',
                    divisionId: ims.id
                }
            });
            console.log('Created sample Power BI report for IMS.');
        }
    }

    console.log('Database initialization complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error during database initialization:', error);
    process.exit(1);
  }
};

initDB();

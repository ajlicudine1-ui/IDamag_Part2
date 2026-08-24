const nodemailer = require('nodemailer');

const sendWelcomeEmail = async (userEmail, plainPassword) => {
  try {
    let transporter;

    // Check if the user has provided real Gmail credentials in the .env file
    if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
        transporter = nodemailer.createTransport({
            service: 'gmail', // Use 'gmail' as the built-in service
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_APP_PASSWORD
            }
        });
        console.log("Using real Gmail SMTP server.");
    } else {
        // Fallback to testing account if no real credentials are set
        console.log("No real credentials found. Falling back to Ethereal Email testing URL...");
        let testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false, // true for 465, false for other ports
          auth: {
            user: testAccount.user, // generated ethereal user
            pass: testAccount.pass, // generated ethereal password
          },
        });
    }

    let info = await transporter.sendMail({
      from: `"Ilocos DAmag Portal" <${process.env.EMAIL_USER || 'no-reply@damag.gov.ph'}>`,
      to: userEmail,
      subject: "Welcome to Ilocos DAmag - Your Account Details",
      text: `Welcome to the Ilocos DAmag Portal!\n\nYour account has been created by an administrator.\n\nYour temporary password is: ${plainPassword}\n\nPlease log in and change your password immediately.`,
      html: `
        <div style="font-family: sans-serif; max-w-lg; margin: 0 auto;">
            <h2 style="color: #475E3B;">Welcome to Ilocos DAmag</h2>
            <p>Your account has been successfully created by an administrator.</p>
            <p>Your temporary password is: <strong>${plainPassword}</strong></p>
            <p style="color: #666; font-size: 14px;">For security measures, you will be required to change your password upon your first login.</p>
            <br>
            <p>Best,<br>Ilocos DAmag IT Team</p>
        </div>
      `,
    });

    console.log("Message sent to %s with ID: %s", userEmail, info.messageId);
    
    // Only log the preview URL if we used the fake Ethereal account
    if (!process.env.EMAIL_USER) {
        console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
        return nodemailer.getTestMessageUrl(info);
    }
    return true;
  } catch (error) {
    console.error("Error sending email", error);
    return null;
  }
};

const generateSecurePassword = () => {
    // Meets strict rules: 1 upper, 1 lower, 1 number, 1 special, 8+ chars
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const nums = '0123456789';
    const symbols = '!@#$%^&*';
    
    let pwd = '';
    pwd += upper[Math.floor(Math.random() * upper.length)];
    pwd += lower[Math.floor(Math.random() * lower.length)];
    pwd += nums[Math.floor(Math.random() * nums.length)];
    pwd += symbols[Math.floor(Math.random() * symbols.length)];
    
    const all = upper + lower + nums + symbols;
    for(let i = 0; i < 6; i++) {
        pwd += all[Math.floor(Math.random() * all.length)];
    }
    
    // Shuffle
    return pwd.split('').sort(() => 0.5 - Math.random()).join('');
};

module.exports = {
  sendWelcomeEmail,
  generateSecurePassword
};

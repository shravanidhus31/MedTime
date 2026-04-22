const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middleware/authMiddleware');
const { encrypt, decrypt } = require('../utils/encryptionUtil');

/**
 * PUT /api/v1/users/doctor-settings
 * Protected — patient must supply a valid JWT.
 * Body: { name, email, autoSendMonthly }
 * Updates the logged-in patient's linkedDoctor sub-document.
 */
router.put('/doctor-settings', verifyToken, async (req, res) => {
  try {
    const { name, email, autoSendMonthly } = req.body;
    const userId = req.user.id;

    // Basic validation — email is required when automation is on
    if (autoSendMonthly && !email) {
      return res.status(400).json({
        message: 'A doctor email address is required to enable automated monthly reports.'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          'linkedDoctor.name': name || '',
          'linkedDoctor.email': email ? encrypt(email.trim().toLowerCase()) : '',
          'linkedDoctor.autoSendMonthly': Boolean(autoSendMonthly)
        }
      },
      { new: true, runValidators: true, select: '-passwordHash -refreshToken' }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Return decrypted email to the frontend
    const safeDoctor = {
      ...updatedUser.linkedDoctor.toObject(),
      email: decrypt(updatedUser.linkedDoctor.email)
    };

    res.status(200).json({
      message: 'Doctor settings saved successfully.',
      linkedDoctor: safeDoctor
    });
  } catch (error) {
    console.error('❌ Error saving doctor settings:', error);
    res.status(500).json({ message: 'Internal server error.', error: error.message });
  }
});

/**
 * GET /api/v1/users/doctor-settings
 * Protected — returns the logged-in patient's current linked-doctor data.
 */
router.get('/doctor-settings', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('linkedDoctor');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Decrypt the stored email before returning it to the client
    const linkedDoctor = user.linkedDoctor
      ? { ...user.linkedDoctor.toObject(), email: decrypt(user.linkedDoctor.email) }
      : {};

    res.status(200).json({ linkedDoctor });
  } catch (error) {
    console.error('❌ Error fetching doctor settings:', error);
    res.status(500).json({ message: 'Internal server error.', error: error.message });
  }
});

module.exports = router;

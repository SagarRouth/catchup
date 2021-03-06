const mongoose          =   require('mongoose');
const express           =   require('express');
const fs                =   require('fs');
const path              =   require('path');
const responseGenerator =   require('./../../libs/responseGenerator');
const auth              =   require('./../../middleware/auth');
const validate          =   require('./../../middleware/validator');
const customLogger      =   require('./../../libs/customLogger');
const shortid           =   require('shortid');
const crypto            =   require('crypto');
const nodemailer        =   require('nodemailer');
const userRouter        =   express.Router();
const users             =   mongoose.model('User');

function userController(app){

  //route to signup
  userRouter.post('/signup', validate('user'),
   (req, res, next) => {
    let newUser = {
      firstName :   req.body.firstName,
      lastName  :   req.body.lastName,
      email     :   req.body.email,
      password  :   req.body.password,
      phone     :   req.body.phone
    };
    newUser.userName = req.body.firstName+shortid.generate();
    req.body.type ? (newUser.type = req.body.type) : '';
    users.create( newUser, (err, user) => {
      if(err) {
        customLogger('Error', 'Controller', __filename, err.stack);
        let errResponse = responseGenerator.generate(true, err.message, 500, null);
        next(errResponse);
      } else {
        customLogger('Info', 'Controller', __filename, 'User successfully added to database');
        //Cloned the user object returned from the callback. The reason being the object was an instance of mongoose model
        //deleting the password property on it had no effect, it exposed the password getter method on its prototype and still
        //password property was accessible
        user = JSON.parse(JSON.stringify(user));
        delete user.password;
        req.session.user = user;
        res.send(responseGenerator.generate(false, 'User successfully added to database', 200, user));
      }
    });
  });

  //route to login
  userRouter.post('/login', validate('user'), (req, res, next) => {
    users.authenticate(req.body.email, req.body.password, (err, user) => {
      if(err) {
        customLogger('Error', 'Controller', __filename, err.stack);
        let errResponse = responseGenerator.generate(true, err.message, 500, null);
        next(errResponse);
      } else {
        customLogger('Info', 'Controller', __filename, 'User successfully logged in');
        //Cloned the user object returned from the callback. The reason being the object was an instance of mongoose model
        //deleting the password property on it had no effect, it exposed the password getter method on its prototype and still
        //password property was accessible
        user = JSON.parse(JSON.stringify(user));
        delete user.password;
        req.session.user = user;
        res.send(responseGenerator.generate(false, 'User successfully logged in', 200, user));
      }
    });
  });

  //route to do profile operations
  userRouter.route('/profile')
  //for all routes under profile, its protected and authentication is required
  .all(auth.checkLoggedIn)
  //route to get the profile details of an user
  .get((req, res, next) => {
    users.findById(req.session.user._id, (err, user) => {
      if(err) {
        customLogger('Error', 'Controller', __filename, err.stack);
        let errResponse = responseGenerator.generate(true, err.message, 500, null);
        next(errResponse);
      } else {
        delete user.password;
        customLogger('Info', 'Controller', __filename, 'Profile Details');
        res.send(responseGenerator.generate(false, 'Profile Details', 200, user));
      }
    });
  })
  //route to edit the profile details of an user
  .put((req, res, next) => {
    const updateObj = {};
    for(let i in req.body) {
      if(i!=='email' && i!=='userName') {
        updateObj[i] = req.body[i];
      }
    }
    users.findByIdAndUpdate(req.session.user._id, updateObj, {new:true}, (err, user) => {
      if(err) {
        customLogger('Error', 'Controller', __filename, err.stack);
        let errResponse = responseGenerator.generate(true, err.message, 500, null);
        next(errResponse);
      } else {
        delete user.password;
        customLogger('Info', 'Controller', __filename, 'Edited Profile Details');
        res.send(responseGenerator.generate(false, 'Edited Profile Details', 200, user));
      }
    });
  });

  //route to logout
  userRouter.get('/logout', (req, res, next) => {
      req.session.destroy( (err) => {
        if(err) {
          customLogger('Error', 'Controller', __filename, err.stack);
          let errResponse = responseGenerator.generate(true, err.message, 500, null);
          next(errResponse); 
        } else {
          customLogger('Info', 'Controller', __filename, 'User Logged Out');
          res.send(responseGenerator.generate(false, 'User Logged Out', 200, null));
        }
      });
  });

  //route to send mail for forgotPassword
  //inspiration taken from various articles on the web
  userRouter.post('/forgotPassword', validate('user'), (req, res, next) => {
    crypto.randomBytes(15, (err, buff) => {
      let token = buff.toString('hex');
      customLogger('Info', 'Controller', __filename, 'Token generated - '+token);
      users.findOne({email: req.body.email}, (err, user) => {
        if(!user) {
          customLogger('Error', 'Controller', __filename, err.stack);
          let errResponse = responseGenerator.generate(true, err.message, 404, null);
          next(errResponse);
        } else {
          user.resetPasswordToken = token;
          user.resetPasswordExpires = Date.now() + 3600000;
          user.save(function(err) {
            if(err) {
              customLogger('Error', 'Controller', __filename, err.stack);
              let errResponse = responseGenerator.generate(true, err.message, 404, null);
              next(errResponse);
            } else {
                customLogger('Info', 'Controller', __filename, 'User saved with resetPasswordToken and resetPasswordExpires');
                const smtpTransport = nodemailer.createTransport({
                  service: 'SendPulse',
                  auth: {
                    user: 'saagarruth0512@gmail.com',
                    pass: 'o7Cdp4gRoQcftmT'
                  }
                });
                const mailOptions = {
                  to: user.email,
                  from: 'saagarruth0512@gmail.com',
                  subject: 'Catchup Password Reset',
                  text: 'You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n' +
                    'Please click on the following link, or paste this into your browser to complete the process:\n\n' +
                    'http://' + req.headers.host + '/users/reset/' + token + '\n\n' +
                    'If you did not request this, please ignore this email and your password will remain unchanged.\n'
                };
                smtpTransport.sendMail(mailOptions, function(err) {
                  if(err) {
                    customLogger('Error', 'Controller', __filename, err.stack);
                    let errResponse = responseGenerator.generate(true, err.message, 500, null);
                    next(errResponse);
                  } else {
                    customLogger('Info', 'Controller', __filename, 'Password reset mail successfully sent');
                    //sometimes i didnt receive the mail, so for testing purpose i have sent the link in the response
                    //by using that link I am able to change the password
                    res.send(responseGenerator.generate(false, 'Password reset mail successfully sent', 200, 'http://' + req.headers.host + '/users/reset/' + token));
                  }
                });
            }
          });
        }
      });
    });
  });

  //route to reset password
  userRouter.post('/reset/:token', validate('user'), (req, res, next) => {
    let errResponse;
    users.findOne({"resetPasswordToken": req.params.token, "resetPasswordExpires":{$gt: Date.now()}}, (err, user) => {
      if(err) {
        customLogger('Error', 'Controller', __filename, err.stack);
        errResponse = responseGenerator.generate(true, err.message, 500, null);
        next(errResponse);
      } else {
        if(!user) {
          customLogger('Error', 'Controller', __filename, 'User not found');
          errResponse = responseGenerator.generate(true, 'User not found', 404, null);
          next(errResponse);
        } else {
          user.password = req.body.password;
          user.resetPasswordExpires = null;
          user.resetPasswordToken = null;
          user.save((err) => {
            if(err) {
              customLogger('Error', 'Controller', __filename, err.stack);
              errResponse = responseGenerator.generate(true, err.message, 500, null);
              next(errResponse);
            } else {
              customLogger('Info', 'Controller', __filename, 'successfully changed password');
              res.send(responseGenerator.generate(false, 'successfully changed password', 200, null));
            }
          });
        }
      }
    });
  });

  app.use('/users', userRouter);
}

module.exports.controller = userController;

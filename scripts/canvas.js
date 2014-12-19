// Description:
//   A collection of CS10 scripts to automate grading with our Canvas LMS
//   instance
//
// Dependencies:
//     node-canvaslms
//
// Configuration:
//   HUBOT_CANVAS_TOKEN
//
//
// Commands:
//   [late]? check off [LAB NUM] [late]? [SIDs...] – Late is optional.
//
// Notes:
//
//
// Author:
//   Michael Ball @cycomachead

var Canvas    = require('node-canvas-lms');
var authToken = process.env.HUBOT_CANVAS_KEY;

var bCoursesURL = 'https://bcourses.berkeley.edu/';
// Update Each Semester
// CS10 FA14: '1246916'
// Michael Sandbox: '1268501'
var cs10CourseID = '1246916';
// Update Each Semester
// CS10 FA14 Labs 1549984
// Michael Sandbox: 1593713
var labsAssnID = '1549984';
// Make sure only a few people can assign grades
// TODO: Grab the actual strings from HipChat
// We can also use the "secret" room...
var allowedRooms = ['lab_check-off_room', 'cs10_staff_room_(private)'] + [ process.env.HUBOT_SECRET_ROOM ];

// Mapping of extenstion IDs to bCourses IDs
var SWAP_IDS = {
    '539182':1083827,
    '538761':1074257,
    '538594':1074141,
    '538652':1007900,
    '539072':1082812,
};
// This is a stupid backwards compatibility thing because these IDs are printed
// on checkoff sheets...it's the just the VALUES of the above map.
var ID_VALS = [];


// @PNHilfinger, this is for you.
// The most useful skill from 61B. ;)
var checkOffRegExp = /(late\s*)?(lab[- ])?check[- ]off\s+(\d+)\s*(late)?\s*((\d+\s*)*)\s*/i;
/* Hubot msg.match groups:
[ '@Alonzo check-off 12 late 1234 1234 1234',
  undefined, // Late?
  undefined, // The word "lab"
  '12',
  'late',
  '1234 1234 1234',
  '1234',
  index: 0,
  input: '@Alonzo check-off 12 late 1234 1234 1234' ]
*/

var slipDaysRegExp = /slip[- ]days\s*(\d+)/;

var cs10 = new Canvas(bCoursesURL, { token: authToken });

/* Fuctions To Do
 * getAllLabs(assnGroupID)
 * MatchLabNumber(int-N)
 * Assign Grade(SID, grade)
 * build Some URL paths
 */

/* Take in a Canvas Assignment Group ID and return all the assignments in that
 * that group. */
var getAllLabs = function(courseID, assnGroupID, callback) {
    var labGroups = '/courses/' + courseID + '/assignment_groups/' + assnGroupID;
    var params = '?include[]=assignments';
    cs10.get(labGroups + params, '', function(body) {
        console.log(body);
    });
};

module.exports = function(robot) {

    if (!authToken) {
        robot.logger.log('HUBOT_CANVAS_KEY token not found!');
        return;
    }

    robot.hear(checkOffRegExp, function(msg) {

        currentRoom = msg.message.room;
        // Prevent grading not done by TAs
        // FIXME -- this is broken in the shell....
        // if (allowedRooms.indexOf(currentRoom) === -1) {
        //     msg.send('You cannot post scores from this room');
        //     return;
        // }
        console.log(msg.match);
        // match[3] is the late parameter.
        var labNo  = msg.match[3],
            points = (msg.match[1] !== undefined || msg.match[4] !== undefined) ? 1 : 2,
            // WTF is wrong with /s+/???
            SIDs   = msg.match[5].trim().split(/[ \t\n]/g);

        // Trim spaces
        var len = SIDs.length, i = 0;
        for (; i < len; i += 1) {
            SIDs[i] = SIDs[i].trim();
            if (SIDs[i].substring(0, 1) == 'X') {
                msg.send('Please specify all extension ids without X.' +
                '\nOr submit a bug fix on github...<3.');
            }
        }

        if (points !== 1) {
            msg.send('Yo, this ain\'t Harvard. Check off students as late now!');
            msg.send('Go to bCourses and enter the scores manually!!');
            msg.send('https://bcourses.berkeley.edu/courses/1246916/gradebook');
            return;
        }

        msg.send('Checking Off ' + SIDs.length + ' students for lab ' + labNo + '.');

        var path = '/courses/' + cs10CourseID + '/assignment_groups/' +
                    labsAssnID;

        cs10.get(path + '?include[]=assignments', '', function(body) {
            var assignments = body.assignments,
                assnID, i = 0;

            if (!assignments) {
                console.log(body);
                msg.send('Oh crap, no assignments were found. Please check the lab number');
                return;
            }

            for (; i < assignments.length; i += 1) {
                var assnName  = assignments[i].name;
                // All labs are named "<#>. <Lab Title> <Date>"
                var searchNum = assnName.split('.');

                if (searchNum[0] == labNo) {
                    assnID = assignments[i].id;
                    break;
                }
            }
            if (!assnID) {
                msg.send('Well, crap...I can\'t find lab ' + msg.match[2] + '.');
                msg.send('Check to make sure you put in a correct lab number.');
                return;
            }
            // now we have an assignment ID we should post scores.
            // iterate over student IDs and then PUT
            var item = 0,
                successes = 0;
            for (; item < SIDs.length; item += 1) {
                var sid = SIDs[item];

                if (!sid) {
                    continue;
                }

                var scoreForm      = 'submission[posted_grade]=' + points,
                    submissionBase = '/courses/' + cs10CourseID +
                                     '/assignments/' + assnID + '/submissions/',
                    submissionPath = submissionBase + 'sis_user_id:',
                    submissionALT  = submissionBase + 'sis_login_id:';

                // FIXME -- this is dumb.
                submissionPath += sid;
                submissionALT  += sid;

                cs10.put(submissionPath , '', scoreForm,
                        callback(sid, points, msg));
            }

            // Access in SID and points in the callback
            function callback(sid, points, msg) {
                return function(body) {
                    // TODO: Make an error function
                    // Absence of a grade indicates an error.
                    // WHY DONT I CHECK HEADERS THATS WHAT THEY ARE FOR
                    if (body.errors || !body.grade || body.grade != points.toString()) {
                        // Attempt to switch to using sis_login_id instead of the sis_user_id
                        // TODO: Make note about not finding sis_user_id and trying sis_login_id
                        cs10.put(submissionALT , '', scoreForm,
                            loginCallback(sid, points, msg));
                    } else {
                        successes += 1;
                    }
                };
            }

            // A modified call back for when sis_login_id is used
            // THese should really be condenced but I didn't want to figure
            // out a proper base case for a recursive callback...lazy....
            function loginCallback(sid, points, msg) {
                return function(body) {
                    var errorMsg = 'Problem encountered for ID: ' +
                                    sid.toString();
                    // TODO: Make an error function
                    // Absence of a grade indicates an error.
                    // WHY DONT I CHECK HEADERS THATS WHAT THEY ARE FOR
                    if (body.errors || !body.grade || body.grade != points.toString()) {
                        // Attempt to switch to using sis_login_id instead of the sis_user_id
                        if (body.errors && body.errors[0]) {
                            errorMsg += '\nERROR:\t' + body.errors[0].message;
                        }
                        errorMsg += '\n' + 'Please enter the score directly in bCoureses.';
                        errorMsg += '\n' + 'https://bcourses.berkeley.edu/courses/1246916/gradebook';
                        msg.send(errorMsg);
                    } else {
                        successes += 1;
                    }
                };
            }

            // wait till all requests are complete...hopefully.
            // FIXME there has got to be a better way to do this..
            setTimeout(function() {
                var score = successes + ' score' + (successes == 1 ? '' : 's');
                msg.send(score + ' successfully updated for lab ' + labNo + '.');
            }, 5000);
        });
    });

    ///////////////////////////////////////////////////////////////////////////

    // https://bcourses.berkeley.edu/api/v1/courses/1246916/assignments/5179913
    var toCheck = [];
    toCheck.push('5179913'); // HW1
    toCheck.push('5179914'); // HW2
    toCheck.push('5179915'); // HW3
    toCheck.push('5179917'); // MT Project
    toCheck.push('5179919'); // Impact Post Link
    toCheck.push('5179935'); // Impact Post comments
    toCheck.push('5179918'); // Final Project
    // toCheck.push(); // Data Project

    var cacheObj = 'ASSIGNMENT_DUE_DATE_';
    /* Assigment Due Date Cache:
     * { cacheDate: <date>, AssnID: <date>, AssnID: <date> .... } */

    /* For all the assignments update the due dates and save them to the
     * 'brain' for Alonzo to avoid redundant http requests
     *  Also save the cache date. */
    function cacheDueDate(assnID) {
        console.log('trying to cache stuff');
        var cache = {};
        var url = '/courses/' + cs10CourseID + '/assignments/';

        // Access Time (in MS) is now
        cache.cacheDate = (new Date()).getTime();

        // Get Assignment Due Date (as strings)
        cs10.get(url + assnID, '', function(body) {
            console.log('cache request ' + assnID);
            if (!body || body.errors) {
                console.log('EROOR');
                return;
                // throw new Error(body.errors[0]);
            }

            if (!body.due_at) {
                console.log('errrrr');
                return;
                // throw new Error('No Due Date found for assignment ' + assign);
            }

            console.log(body.due_at);
            console.log(cache);
            cache[assign] = body.due_at; // Save the actual date

            // Save the cache
            console.log('Setting Cache');
            robot.brain.set(cacheObj, cache);
            robot.log('bCourses slip days cache updated');
        });
    }

    /* Check if the assignment cache exists, if it does, check if it is
     * less than 1 week old */
    function cacheIsValid(assnID) {
        console.log('Valid Check  ' + assnID);
        var maxAge = 1000 * 60 * 60 * 24 * 7; // 1 Week
        var now    = (new Date()).getTime();
        var cachedData = robot.brain.get(cacheObj + assnID);

        if (!cachedData) {
            console.log('no cache found');
            return false; // No cache found
        }

        if (cachedData.cacheDate) {
            return now - cachedData.cacheDate < maxAge;
        }

        return false; // Couldn't find a cache date, so be cautious
    }


    function getSlipDays(submissionTime, dueTime) {
        var threshold = 1000 * 60 * 30,
            oneDay    = 1000 * 60 * 60 * 24,
            d1 = new Date(submissionTime),
            d2 = new Date(dueTime);

        var diff = Math.abs(d1 - d2);

        if (diff < threshold) {
            return 0;
        }
        // This is somewhat shitty if you use slightly more than a day
        // TODO: only floor if < .1 difference
        return Math.ceil(diff / oneDay);
    }

    /* Iterate over all the assignments to check */
    function calculateSlipDays(sid, msg) {
        var daysUsed = 0, checked = 0;
        // TODO: Once again... do the extenstion student thing
        var url = '/courses/' + cs10CourseID + '/assignments/';
        var urlEnd = '/submissions/sis_user_id:' + sid;

        var i = 0, end = toCheck.length;
        var assn = '';
        for(; i < end; i += 1) {
            assn = toCheck[i];
            console.log('checking assignment ' + assn);
            cs10.get(url + assn + urlEnd, '', function (body) {

                console.log('CHECKED');

                if (!body || body.errors) {
                    console.log('errrrrroorrrrrrrrrr');
                    // ugggggghhhh
                }

                if (body.late) { // body.late is fale even for no submission!

                    if (!cacheIsValid(assn)) {
                        cacheDueDate(assn);
                        console.log('cached');
                        setTimeout(function() { // Replace this thing with a callback to the above function....
                            var dueDate = robot.brain.get(cacheObj + assn);
                            checked += 1;

                            var day = getSlipDays(body.submitted_at, dueDate[assn]);
                            msg.send('Used ' + day + ' day' + (day === 1 ? '' : 's') +
                            ' for assignment ' + assn + '.');
                            daysUsed += day;

                            if (checked === toCheck.length) { // Ran through the list
                                msg.send(daysUsed + ' slip days were used');
                            }
                        }, 2000);
                    } else {
                        var dueDate = robot.brain.get(cacheObj + assn);
                        checked += 1;

                        var day = getSlipDays(body.submitted_at, dueDate[assn]);
                        msg.send('Used ' + day + ' day' + (day === 1 ? '' : 's') +
                        ' for assignment ' + assn + '.');
                        daysUsed += day;
                    }
                }

                if (checked === toCheck.length) { // Ran through the list
                    msg.send(daysUsed + ' slip days were used');
                }
            });
        }
    }

    robot.hear(slipDaysRegExp, function(msg) {
        var student = msg.match[1];

        if (!student) {
            msg.send('Error: No Student Provided');
            return;
        }

        // Check Student Exists
        // TODO: Fix this crap for extension students
        var url = '/courses/' + cs10CourseID + 'users/sis_user_id' + student;
        cs10.get(url, '', function(body) {
            if (!body || body.errors) { // TODO: Make this crap more generic?
                msg.send('Error occurred for SID: ' + student);
                if (body.errors && body.errors[0] && body.errors[0].message) {
                    msg.send(ody.errors[0].message);
                }
            }

            console.log('Checking student');
            msg.send('Checking slip days for ' +
                     (body.name ? body.name : student) + '.');
        });

        // Do the dirty work...
        calculateSlipDays(student, msg);
    });



};

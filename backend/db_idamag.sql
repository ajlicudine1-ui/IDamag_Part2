/*
MySQL Data Transfer
Source Host: localhost
Source Database: db_idamag
Target Host: localhost
Target Database: db_idamag
Date: 27 Apr 2026 2:28:30 pm
*/

SET FOREIGN_KEY_CHECKS=0;
-- ----------------------------
-- Table structure for activitylogs
-- ----------------------------
DROP TABLE IF EXISTS `activitylogs`;
CREATE TABLE `activitylogs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userId` int(11) DEFAULT NULL,
  `action` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `ipAddress` varchar(255) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `userId` (`userId`),
  CONSTRAINT `activitylogs_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=72 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for divisions
-- ----------------------------
DROP TABLE IF EXISTS `divisions`;
CREATE TABLE `divisions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `officeId` int(11) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `acronym` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Divisions_name_officeId_unique` (`name`,`officeId`),
  UNIQUE KEY `divisions_name_office_id` (`name`,`officeId`),
  KEY `officeId` (`officeId`),
  CONSTRAINT `divisions_ibfk_1` FOREIGN KEY (`officeId`) REFERENCES `offices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for offices
-- ----------------------------
DROP TABLE IF EXISTS `offices`;
CREATE TABLE `offices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `acronym` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  UNIQUE KEY `name_2` (`name`),
  UNIQUE KEY `name_3` (`name`),
  UNIQUE KEY `name_4` (`name`),
  UNIQUE KEY `name_5` (`name`),
  UNIQUE KEY `name_6` (`name`),
  UNIQUE KEY `name_7` (`name`),
  UNIQUE KEY `name_8` (`name`),
  UNIQUE KEY `name_9` (`name`),
  UNIQUE KEY `name_10` (`name`),
  UNIQUE KEY `name_11` (`name`),
  UNIQUE KEY `name_12` (`name`),
  UNIQUE KEY `name_13` (`name`),
  UNIQUE KEY `name_14` (`name`),
  UNIQUE KEY `name_15` (`name`),
  UNIQUE KEY `name_16` (`name`),
  UNIQUE KEY `name_17` (`name`),
  UNIQUE KEY `name_18` (`name`),
  UNIQUE KEY `name_19` (`name`),
  UNIQUE KEY `name_20` (`name`),
  UNIQUE KEY `name_21` (`name`),
  UNIQUE KEY `name_22` (`name`),
  UNIQUE KEY `name_23` (`name`),
  UNIQUE KEY `name_24` (`name`),
  UNIQUE KEY `name_25` (`name`),
  UNIQUE KEY `name_26` (`name`),
  UNIQUE KEY `name_27` (`name`),
  UNIQUE KEY `name_28` (`name`),
  UNIQUE KEY `name_29` (`name`),
  UNIQUE KEY `name_30` (`name`),
  UNIQUE KEY `name_31` (`name`),
  UNIQUE KEY `name_32` (`name`),
  UNIQUE KEY `name_33` (`name`),
  UNIQUE KEY `name_34` (`name`),
  UNIQUE KEY `name_35` (`name`),
  UNIQUE KEY `name_36` (`name`),
  UNIQUE KEY `name_37` (`name`),
  UNIQUE KEY `name_38` (`name`),
  UNIQUE KEY `name_39` (`name`),
  UNIQUE KEY `name_40` (`name`),
  UNIQUE KEY `name_41` (`name`),
  UNIQUE KEY `name_42` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for reports
-- ----------------------------
DROP TABLE IF EXISTS `reports`;
CREATE TABLE `reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `divisionId` int(11) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `reportId` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `divisionId` (`divisionId`),
  CONSTRAINT `reports_ibfk_1` FOREIGN KEY (`divisionId`) REFERENCES `divisions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('Admin','Staff') DEFAULT 'Staff',
  `officeId` int(11) NOT NULL,
  `divisionId` int(11) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `firstName` varchar(255) DEFAULT NULL,
  `lastName` varchar(255) DEFAULT NULL,
  `suffix` varchar(255) DEFAULT NULL,
  `requiresPasswordChange` tinyint(1) DEFAULT 0,
  `isActive` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `email_2` (`email`),
  UNIQUE KEY `email_3` (`email`),
  UNIQUE KEY `email_4` (`email`),
  UNIQUE KEY `email_5` (`email`),
  UNIQUE KEY `email_6` (`email`),
  UNIQUE KEY `email_7` (`email`),
  UNIQUE KEY `email_8` (`email`),
  UNIQUE KEY `email_9` (`email`),
  UNIQUE KEY `email_10` (`email`),
  UNIQUE KEY `email_11` (`email`),
  UNIQUE KEY `email_12` (`email`),
  UNIQUE KEY `email_13` (`email`),
  UNIQUE KEY `email_14` (`email`),
  UNIQUE KEY `email_15` (`email`),
  UNIQUE KEY `email_16` (`email`),
  UNIQUE KEY `email_17` (`email`),
  UNIQUE KEY `email_18` (`email`),
  UNIQUE KEY `email_19` (`email`),
  UNIQUE KEY `email_20` (`email`),
  UNIQUE KEY `email_21` (`email`),
  UNIQUE KEY `email_22` (`email`),
  UNIQUE KEY `email_23` (`email`),
  UNIQUE KEY `email_24` (`email`),
  UNIQUE KEY `email_25` (`email`),
  UNIQUE KEY `email_26` (`email`),
  UNIQUE KEY `email_27` (`email`),
  UNIQUE KEY `email_28` (`email`),
  UNIQUE KEY `email_29` (`email`),
  UNIQUE KEY `email_30` (`email`),
  UNIQUE KEY `email_31` (`email`),
  UNIQUE KEY `email_32` (`email`),
  UNIQUE KEY `email_33` (`email`),
  KEY `officeId` (`officeId`),
  KEY `divisionId` (`divisionId`),
  CONSTRAINT `users_ibfk_57` FOREIGN KEY (`officeId`) REFERENCES `offices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `users_ibfk_58` FOREIGN KEY (`divisionId`) REFERENCES `divisions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Records 
-- ----------------------------
INSERT INTO `activitylogs` VALUES ('24', '1', 'LOGIN_FAIL', 'Incorrect password for admin@gmail.com', null, '::1', '2026-04-26 03:56:24');
INSERT INTO `activitylogs` VALUES ('25', '9', 'REGISTRATION', 'New user self-registered: andrea@email.com', null, '::1', '2026-04-26 03:57:37');
INSERT INTO `activitylogs` VALUES ('26', '9', 'LOGIN_SUCCESS', 'User logged in: andrea@email.com', null, '::1', '2026-04-26 03:58:09');
INSERT INTO `activitylogs` VALUES ('27', '9', 'EDIT_REPORT', 'Report updated: Regional Soils Laboratory Dashboard', 0x7B227265706F72744964223A2236227D, '::1', '2026-04-26 03:59:53');
INSERT INTO `activitylogs` VALUES ('28', '9', 'EDIT_OFFICE', 'Office updated: Integrated Laboratories Division', 0x7B226F66666963654964223A2235227D, '::1', '2026-04-26 04:00:49');
INSERT INTO `activitylogs` VALUES ('29', '9', 'ADD_SECTION', 'New section created: Regional Soils Laboratory', 0x7B2273656374696F6E4964223A357D, '::1', '2026-04-26 04:01:15');
INSERT INTO `activitylogs` VALUES ('30', '9', 'EDIT_REPORT', 'Report updated: Regional Soils Laboratory Dashboard', 0x7B227265706F72744964223A2236227D, '::1', '2026-04-26 04:01:34');
INSERT INTO `activitylogs` VALUES ('31', '9', 'ADD_SECTION', 'New section created: Budget Section', 0x7B2273656374696F6E4964223A387D, '::1', '2026-04-26 04:36:20');
INSERT INTO `activitylogs` VALUES ('32', '9', 'ADD_REPORT', 'New report added: 2026 Regional Financial Utilization Dashboard', 0x7B227265706F72744964223A31307D, '::1', '2026-04-26 04:37:14');
INSERT INTO `activitylogs` VALUES ('33', '9', 'ADD_SECTION', 'New section created: Rice Banner Program', 0x7B2273656374696F6E4964223A397D, '::1', '2026-04-26 05:05:10');
INSERT INTO `activitylogs` VALUES ('34', '9', 'ADD_REPORT', 'New report added: Regional Rice Planting Dashboard', 0x7B227265706F72744964223A31317D, '::1', '2026-04-26 05:05:53');
INSERT INTO `activitylogs` VALUES ('35', '9', 'ADD_SECTION', 'New section created: Philippine Rural Development Project', 0x7B2273656374696F6E4964223A31307D, '::1', '2026-04-26 05:06:31');
INSERT INTO `activitylogs` VALUES ('36', '9', 'ADD_REPORT', 'New report added: PRDP-RPCO 1 Subprojects Dashboard', 0x7B227265706F72744964223A31327D, '::1', '2026-04-26 05:07:11');
INSERT INTO `activitylogs` VALUES ('37', '9', 'ADD_SECTION', 'New section created: Ilocos Integrated Agricultural Research Center', 0x7B2273656374696F6E4964223A31317D, '::1', '2026-04-26 05:21:56');
INSERT INTO `activitylogs` VALUES ('38', '9', 'ADD_REPORT', 'New report added: Production Support Services Dashboard', 0x7B227265706F72744964223A31337D, '::1', '2026-04-26 05:23:16');
INSERT INTO `activitylogs` VALUES ('39', '9', 'ADD_SECTION', 'New section created: Price Monitoring', 0x7B2273656374696F6E4964223A31327D, '::1', '2026-04-26 05:41:50');
INSERT INTO `activitylogs` VALUES ('40', '9', 'ADD_REPORT', 'New report added: Integrated Farmgate Price Monitoring Dashboard', 0x7B227265706F72744964223A31347D, '::1', '2026-04-26 05:43:26');
INSERT INTO `activitylogs` VALUES ('41', '9', 'DELETE_SECTION', 'Section removed: Management Information System', 0x7B2264656C657465644964223A2233227D, '::1', '2026-04-26 05:43:51');
INSERT INTO `activitylogs` VALUES ('42', '9', 'DELETE_SECTION', 'Section removed: Information Communication Technology', 0x7B2264656C657465644964223A2232227D, '::1', '2026-04-26 05:44:06');
INSERT INTO `activitylogs` VALUES ('43', '9', 'DELETE_REPORT', 'Report removed: Rice Production', 0x7B2264656C657465644964223A2233227D, '::1', '2026-04-26 05:45:04');
INSERT INTO `activitylogs` VALUES ('44', '9', 'LOGIN_SUCCESS', 'User logged in: andrea@email.com', null, '172.16.10.180', '2026-04-27 02:10:59');
INSERT INTO `activitylogs` VALUES ('45', '9', 'ADD_SECTION', 'New section created: Livestock Banner Program', 0x7B2273656374696F6E4964223A31337D, '172.16.10.180', '2026-04-27 02:49:37');
INSERT INTO `activitylogs` VALUES ('46', '9', 'ADD_REPORT', 'New report added: UNAIP Dashboard', 0x7B227265706F72744964223A31357D, '172.16.10.180', '2026-04-27 02:50:23');
INSERT INTO `activitylogs` VALUES ('47', '9', 'ADD_SECTION', 'New section created: 4K', 0x7B2273656374696F6E4964223A31347D, '172.16.10.180', '2026-04-27 02:50:43');
INSERT INTO `activitylogs` VALUES ('48', '9', 'ADD_REPORT', 'New report added: 4K Dashboard', 0x7B227265706F72744964223A31367D, '172.16.10.180', '2026-04-27 02:51:04');
INSERT INTO `activitylogs` VALUES ('49', '9', 'ADD_SECTION', 'New section created: Monitoring and Evaluation Section', 0x7B2273656374696F6E4964223A31357D, '172.16.10.180', '2026-04-27 02:51:27');
INSERT INTO `activitylogs` VALUES ('50', '9', 'ADD_REPORT', 'New report added: BCM Dashboard', 0x7B227265706F72744964223A31377D, '172.16.10.180', '2026-04-27 02:51:47');
INSERT INTO `activitylogs` VALUES ('51', '9', 'ADD_SECTION', 'New section created: Accounting Section', 0x7B2273656374696F6E4964223A31367D, '172.16.10.180', '2026-04-27 02:52:30');
INSERT INTO `activitylogs` VALUES ('52', '9', 'ADD_REPORT', 'New report added: Fund Transfers to Other Implementing Agencies Dashboard', 0x7B227265706F72744964223A31387D, '172.16.10.180', '2026-04-27 02:52:59');
INSERT INTO `activitylogs` VALUES ('53', '9', 'ADD_SECTION', 'New section created: Halal', 0x7B2273656374696F6E4964223A31377D, '172.16.10.180', '2026-04-27 02:53:25');
INSERT INTO `activitylogs` VALUES ('54', '9', 'ADD_REPORT', 'New report added: HALAL Dashboard', 0x7B227265706F72744964223A31397D, '172.16.10.180', '2026-04-27 02:53:49');
INSERT INTO `activitylogs` VALUES ('55', '9', 'ADD_SECTION', 'New section created: Human Resource Management Section', 0x7B2273656374696F6E4964223A31387D, '172.16.10.180', '2026-04-27 02:54:16');
INSERT INTO `activitylogs` VALUES ('56', '9', 'ADD_REPORT', 'New report added: HRMS Dashboard', 0x7B227265706F72744964223A32307D, '172.16.10.180', '2026-04-27 02:54:35');
INSERT INTO `activitylogs` VALUES ('57', '9', 'ADD_SECTION', 'New section created: INREC Dingras', 0x7B2273656374696F6E4964223A31397D, '172.16.10.180', '2026-04-27 02:55:15');
INSERT INTO `activitylogs` VALUES ('58', '9', 'ADD_REPORT', 'New report added: INREC Dingras Dashboard', 0x7B227265706F72744964223A32317D, '172.16.10.180', '2026-04-27 02:55:38');
INSERT INTO `activitylogs` VALUES ('59', '9', 'LOGIN_SUCCESS', 'User logged in: andrea@email.com', null, '172.16.12.203', '2026-04-27 03:55:12');
INSERT INTO `activitylogs` VALUES ('60', '9', 'LOGOUT', 'User logged out: andrea@email.com', null, '172.16.12.203', '2026-04-27 03:55:53');
INSERT INTO `activitylogs` VALUES ('61', '9', 'LOGIN_SUCCESS', 'User logged in: andrea@email.com', null, '172.16.12.203', '2026-04-27 04:02:39');
INSERT INTO `activitylogs` VALUES ('62', '9', 'ADD_SECTION', 'New section created: PREC Sual', 0x7B2273656374696F6E4964223A32307D, '172.16.12.203', '2026-04-27 04:03:20');
INSERT INTO `activitylogs` VALUES ('63', '9', 'ADD_REPORT', 'New report added: IRISE4RICE', 0x7B227265706F72744964223A32327D, '172.16.12.203', '2026-04-27 04:04:30');
INSERT INTO `activitylogs` VALUES ('64', '9', 'ADD_REPORT', 'New report added: Rice Planting Activities Dashboard', 0x7B227265706F72744964223A32337D, '172.16.12.203', '2026-04-27 04:06:27');
INSERT INTO `activitylogs` VALUES ('65', '9', 'ADD_SECTION', 'New section created: Ilocos Sur Research Center', 0x7B2273656374696F6E4964223A32317D, '172.16.12.203', '2026-04-27 04:08:08');
INSERT INTO `activitylogs` VALUES ('66', '9', 'ADD_REPORT', 'New report added: ISReC Dashboard', 0x7B227265706F72744964223A32347D, '172.16.12.203', '2026-04-27 04:08:32');
INSERT INTO `activitylogs` VALUES ('67', '9', 'ADD_SECTION', 'New section created: Regulatory', 0x7B2273656374696F6E4964223A32327D, '172.16.12.203', '2026-04-27 04:09:39');
INSERT INTO `activitylogs` VALUES ('68', '9', 'ADD_REPORT', 'New report added: Rabies Sample Collection and Test Results Dashboard', 0x7B227265706F72744964223A32357D, '172.16.12.203', '2026-04-27 04:11:07');
INSERT INTO `activitylogs` VALUES ('69', '9', 'ADD_SECTION', 'New section created: Research', 0x7B2273656374696F6E4964223A32337D, '172.16.12.203', '2026-04-27 04:12:50');
INSERT INTO `activitylogs` VALUES ('70', '9', 'ADD_REPORT', 'New report added: RCM Dashboard', 0x7B227265706F72744964223A32367D, '172.16.12.203', '2026-04-27 04:13:38');
INSERT INTO `activitylogs` VALUES ('71', '9', 'LOGOUT', 'User logged out: andrea@email.com', null, '172.16.12.203', '2026-04-27 04:14:27');
INSERT INTO `divisions` VALUES ('1', 'Information Management Section', '3', '2026-03-24 09:19:06', '2026-03-24 05:26:31', 'IMS');
INSERT INTO `divisions` VALUES ('5', 'Regional Soils Laboratory', '5', '2026-04-26 04:01:15', '2026-04-26 04:01:15', 'RSL');
INSERT INTO `divisions` VALUES ('8', 'Budget Section', '1', '2026-04-26 04:36:20', '2026-04-26 04:36:20', 'Budget');
INSERT INTO `divisions` VALUES ('9', 'Rice Banner Program', '2', '2026-04-26 05:05:09', '2026-04-26 05:05:09', 'Rice');
INSERT INTO `divisions` VALUES ('10', 'Philippine Rural Development Project', '9', '2026-04-26 05:06:31', '2026-04-26 05:06:31', 'PRDP');
INSERT INTO `divisions` VALUES ('11', 'Ilocos Integrated Agricultural Research Center', '8', '2026-04-26 05:21:55', '2026-04-26 05:21:55', 'ILIARC');
INSERT INTO `divisions` VALUES ('12', 'Price Monitoring', '4', '2026-04-26 05:41:50', '2026-04-26 05:41:50', '');
INSERT INTO `divisions` VALUES ('13', 'Livestock Banner Program', '2', '2026-04-27 02:49:36', '2026-04-27 02:49:36', 'Livestock');
INSERT INTO `divisions` VALUES ('14', '4K', '2', '2026-04-27 02:50:43', '2026-04-27 02:50:43', '4K');
INSERT INTO `divisions` VALUES ('15', 'Monitoring and Evaluation Section', '3', '2026-04-27 02:51:27', '2026-04-27 02:51:27', 'MES');
INSERT INTO `divisions` VALUES ('16', 'Accounting Section', '1', '2026-04-27 02:52:30', '2026-04-27 02:52:30', 'Accounting');
INSERT INTO `divisions` VALUES ('17', 'Halal', '2', '2026-04-27 02:53:25', '2026-04-27 02:53:25', 'Halal');
INSERT INTO `divisions` VALUES ('18', 'Human Resource Management Section', '1', '2026-04-27 02:54:16', '2026-04-27 02:54:16', 'HRMS');
INSERT INTO `divisions` VALUES ('19', 'INREC Dingras', '8', '2026-04-27 02:55:15', '2026-04-27 02:55:15', 'INREC Dingras');
INSERT INTO `divisions` VALUES ('20', 'PREC Sual', '8', '2026-04-27 04:03:20', '2026-04-27 04:03:20', 'PREC Sual');
INSERT INTO `divisions` VALUES ('21', 'Ilocos Sur Research Center', '8', '2026-04-27 04:08:08', '2026-04-27 04:08:08', 'ISReC');
INSERT INTO `divisions` VALUES ('22', 'Regulatory', '7', '2026-04-27 04:09:39', '2026-04-27 04:09:39', 'Regulatory');
INSERT INTO `divisions` VALUES ('23', 'Research', '8', '2026-04-27 04:12:50', '2026-04-27 04:12:50', 'Research');
INSERT INTO `offices` VALUES ('1', 'Administrative and Finance Division', '2026-03-24 09:19:06', '2026-03-24 09:19:06', 'AFD');
INSERT INTO `offices` VALUES ('2', 'Field Operations Division', '2026-03-24 09:19:06', '2026-03-24 09:19:06', 'FOD');
INSERT INTO `offices` VALUES ('3', 'Planning, Monitoring & Evaluation Division', '2026-03-24 09:19:06', '2026-03-24 09:19:06', 'PMED');
INSERT INTO `offices` VALUES ('4', 'Agribusiness and Marketing Assistance Division', '2026-03-24 09:19:06', '2026-03-24 09:19:06', 'AMAD');
INSERT INTO `offices` VALUES ('5', 'Integrated Laboratories Division', '2026-03-24 09:19:06', '2026-04-26 04:00:49', 'ILD');
INSERT INTO `offices` VALUES ('6', 'Regional Agricultural Engineering Division', '2026-03-24 09:19:06', '2026-03-24 09:19:06', 'RAED');
INSERT INTO `offices` VALUES ('7', 'Regulatory Division', '2026-03-24 09:19:06', '2026-03-24 09:19:06', 'Regulatory');
INSERT INTO `offices` VALUES ('8', 'Research Division', '2026-03-24 09:19:06', '2026-03-24 09:19:06', 'Research');
INSERT INTO `offices` VALUES ('9', 'Philippine Rural Development Project', '2026-03-24 09:19:06', '2026-03-24 09:19:06', 'PRDP');
INSERT INTO `reports` VALUES ('1', 'CSM Analytics Dashboard 2025', '', '1', '2026-03-24 02:22:03', '2026-03-24 02:50:08', 'eyJrIjoiYzcyOTkxMDctMGFlMS00YzMxLWJlZTktMjI2MzI3NzY5NTgwIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('2', 'Feed Evaluation Result 2025', '', '1', '2026-03-24 02:27:09', '2026-03-24 02:50:14', 'eyJrIjoiYzcyOTkxMDctMGFlMS00YzMxLWJlZTktMjI2MzI3NzY5NTgwIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('6', 'Regional Soils Laboratory Dashboard', 'The Regional Soils Laboratory Dashboard is a centralized visual tool that presents key operational, technical, and quality laboratory data in a clear and real time format. It supports efficient monitoring of laboratory activities such as sample receiving, testing and releasing laboratory test results, thus, enhance decision making, transparency, and accountability.', '5', '2026-03-30 05:34:25', '2026-04-26 04:01:34', 'eyJrIjoiMjZlMTY5YzQtMTcxNS00NjkzLThjMGEtNTZjYWZjMTQxY2RkIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('10', '2026 Regional Financial Utilization Dashboard', '', '8', '2026-04-26 04:37:14', '2026-04-26 04:37:14', 'eyJrIjoiYmU5YWE1MDctZWVmYi00NmRmLThhMTAtMmQ4YTAxMjVkNjM4IiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('11', 'Regional Rice Planting Dashboard', '', '9', '2026-04-26 05:05:53', '2026-04-26 05:05:53', 'eyJrIjoiYmY4YWZhYTAtZjcwZi00OTZiLTg3YTAtYTEwYTcwNDgxMDUyIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('12', 'PRDP-RPCO 1 Subprojects Dashboard', '', '10', '2026-04-26 05:07:11', '2026-04-26 05:07:11', 'eyJrIjoiNDhiYjExNWYtMjVkYi00YmY4LTkwMTgtZjMwYzkxMmQ0ODk4IiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('13', 'Production Support Services Dashboard', '', '11', '2026-04-26 05:23:16', '2026-04-26 05:23:16', 'eyJrIjoiZGFiY2Q2ODYtNDI1OC00N2VjLTgyOTQtYjQ2ZTY4MTg3OWVhIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('14', 'Integrated Farmgate Price Monitoring Dashboard', '', '12', '2026-04-26 05:43:26', '2026-04-26 05:43:26', 'eyJrIjoiZTA1Y2NhMmMtNmVmZi00NWUzLTkwOWUtMTc1Njg1YjdhODdmIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('15', 'UNAIP Dashboard', 'Unified National Artificial Insemination Program Dashboard', '13', '2026-04-27 02:50:23', '2026-04-27 02:50:23', 'eyJrIjoiM2VkMmIyNGUtOTdiNi00NTA1LThkODctMTQ5MDhjZGYzMzc2IiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('16', '4K Dashboard', '', '14', '2026-04-27 02:51:04', '2026-04-27 02:51:04', 'eyJrIjoiYzQ3Zjg0YTQtMzgxNS00NzU0LWEyM2ItMmJmZTA2OThhMGYwIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('17', 'BCM Dashboard', '', '15', '2026-04-27 02:51:47', '2026-04-27 02:51:47', 'eyJrIjoiYTk0NDE1ZDYtYTUzNC00Njk2LWE0MTAtM2I1ZTRjZmY4YTMxIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('18', 'Fund Transfers to Other Implementing Agencies Dashboard', '', '16', '2026-04-27 02:52:59', '2026-04-27 02:52:59', 'eyJrIjoiYjRiYzE2NTctMDkxNC00YjE2LThmY2EtZGU2YTM2Yzg1NTczIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('19', 'HALAL Dashboard', '', '17', '2026-04-27 02:53:49', '2026-04-27 02:53:49', 'eyJrIjoiMzlhZjZhZDItZmM4My00NTg0LTg3ZWItOWI4MTgyNWM4NjJlIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('20', 'HRMS Dashboard', '', '18', '2026-04-27 02:54:35', '2026-04-27 02:54:35', 'eyJrIjoiYjk5NDVhODgtMjFjMS00N2NhLWFkOTEtZjIwMjBhNmI3NTFiIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('21', 'INREC Dingras Dashboard', '', '19', '2026-04-27 02:55:38', '2026-04-27 02:55:38', 'eyJrIjoiMmNkNDgxMTAtOWM3My00Y2ViLTllYzEtMWVjZDczMTAwNDJjIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('22', 'IRISE4RICE', '', '20', '2026-04-27 04:04:30', '2026-04-27 04:04:30', 'eyJrIjoiMDhkNmExNDAtNDQwOC00OWUyLTg1MTQtYmU4YzQzZGE3NDAzIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('23', 'Rice Planting Activities Dashboard', '', '9', '2026-04-27 04:06:27', '2026-04-27 04:06:27', 'eyJrIjoiMmY0N2M5MjItMWY5Zi00OTExLThlMzAtNGI4YzE0YTZiMmY4IiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('24', 'ISReC Dashboard', '', '21', '2026-04-27 04:08:32', '2026-04-27 04:08:32', 'eyJrIjoiMGZlNzYyNjMtMzFkNi00YjlhLTg3YTUtYmUwNzUxMDUwZjVhIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('25', 'Rabies Sample Collection and Test Results Dashboard', '', '22', '2026-04-27 04:11:07', '2026-04-27 04:11:07', 'eyJrIjoiOTE2YWRhMDctMjcxYi00NDAwLTlkMTYtZTdmOWU5ZDA4Y2YzIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `reports` VALUES ('26', 'RCM Dashboard', '', '23', '2026-04-27 04:13:38', '2026-04-27 04:13:38', 'eyJrIjoiZTNlMGRjNjQtZWM4OC00YjM5LTlhM2MtZTFhN2ViZTY2OTNmIiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ==');
INSERT INTO `users` VALUES ('1', 'admin@gmail.com', '$2b$10$UmIQLpMuw57VPgjHEW2XfOL10FEa6Ydt8mDQBFxZyttC8mgB0Wwcm', 'Admin', '3', '1', '2026-03-24 09:19:06', '2026-03-30 05:35:34', 'Nikolai', 'Cabrera', null, '0', '1');
INSERT INTO `users` VALUES ('9', 'andrea@email.com', '$2b$10$3w9uQPZAozagQJFG7iKIT.4tOffzV9cOmEc7c3AF1trzC36q4nv2y', 'Admin', '3', '1', '2026-04-26 03:57:37', '2026-04-26 03:57:37', 'Andrea', 'Franco', '', '0', '1');

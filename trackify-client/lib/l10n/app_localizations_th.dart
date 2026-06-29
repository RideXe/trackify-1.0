// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Thai (`th`).
class AppLocalizationsTh extends AppLocalizations {
  AppLocalizationsTh([String locale = 'th']) : super(locale);

  @override
  String get trackingTitle => 'การติดตาม';

  @override
  String get settingsTitle => 'การตั้งค่า';

  @override
  String get statusTitle => 'Logs';

  @override
  String get saveButton => 'บันทึก';

  @override
  String get cancelButton => 'ยกเลิก';

  @override
  String get okButton => 'ตกลง';

  @override
  String get locationButton => 'ส่งสถานที่';

  @override
  String get statusButton => 'แสดงสถานะ';

  @override
  String get settingsButton => 'เปลี่ยนการตั้งค่า';

  @override
  String get invalidValue => 'ค่าไม่ถูกต้อง';

  @override
  String get disabledValue => 'ปิดการใช้งาน';

  @override
  String get idLabel => 'หมายเลขอุปกรณ์';

  @override
  String get urlLabel => 'URL เซิร์ฟเวอร์';

  @override
  String get accuracyLabel => 'ความแม่นยำของตำแหน่ง';

  @override
  String get highestAccuracyLabel => 'สูงสุด';

  @override
  String get highAccuracyLabel => 'สูง';

  @override
  String get mediumAccuracyLabel => 'ปานกลาง';

  @override
  String get lowAccuracyLabel => 'ต่ำ';

  @override
  String get intervalLabel => 'ช่วงเวลา (วินาที)';

  @override
  String get fastestIntervalLabel => 'ช่วงเวลาที่เร็วที่สุด (วินาที)';

  @override
  String get distanceLabel => 'ระยะทาง (เมตร)';

  @override
  String get angleLabel => 'มุม (องศา)';

  @override
  String get heartbeatLabel => 'การเต้นของหัวใจคงที่ (วินาที)';

  @override
  String get bufferLabel => 'การบัฟเฟอร์แบบออฟไลน์';

  @override
  String get wakelockLabel => 'ป้องกันไม่ให้อุปกรณ์เข้าสู่โหมดพัก';

  @override
  String get stopDetectionLabel => 'หยุดการตรวจจับ';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'ติดตามอย่างต่อเนื่อง';

  @override
  String get advancedLabel => 'การตั้งค่าขั้นสูง';

  @override
  String get passwordLabel => 'รหัสผ่าน';

  @override
  String get optimizationMessage =>
      'เพื่อให้การติดตามตำแหน่งทำงานได้อย่างต่อเนื่อง โปรดปิดการเพิ่มประสิทธิภาพแบตเตอรี่สำหรับแอปนี้';

  @override
  String get passwordError => 'รหัสผ่านไม่ถูกต้อง';

  @override
  String get startAction => 'เริ่มต้นบริการ';

  @override
  String get stopAction => 'หยุดบริการ';

  @override
  String get sosAction => 'ส่ง SOS';

  @override
  String get disclosureMessage =>
      'แอปนี้จะรวบรวมข้อมูลตำแหน่งที่ตั้งและกิจกรรมต่างๆ ในเบื้องหลัง และส่งไปยังเซิร์ฟเวอร์ที่ตั้งค่าไว้';

  @override
  String get configurationMessage => 'ใช้การกำหนดค่าใหม่ใช่ไหม';
}

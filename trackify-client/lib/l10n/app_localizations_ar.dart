// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get trackingTitle => 'التتبع';

  @override
  String get settingsTitle => 'الإعدادات';

  @override
  String get statusTitle => 'السجلات';

  @override
  String get saveButton => 'حفظ';

  @override
  String get cancelButton => 'إلغاء';

  @override
  String get okButton => 'موافق';

  @override
  String get locationButton => 'إرسال الموقع';

  @override
  String get statusButton => 'عرض الحالة';

  @override
  String get settingsButton => 'تغيير الإعدادات';

  @override
  String get invalidValue => 'قيمة غير صالحة';

  @override
  String get disabledValue => 'معطل';

  @override
  String get idLabel => 'معرّف الجهاز';

  @override
  String get urlLabel => 'عنوان الخادم';

  @override
  String get accuracyLabel => 'دقة الموقع';

  @override
  String get highestAccuracyLabel => 'أعلى';

  @override
  String get highAccuracyLabel => 'عالية';

  @override
  String get mediumAccuracyLabel => 'متوسطة';

  @override
  String get lowAccuracyLabel => 'منخفضة';

  @override
  String get intervalLabel => 'الفاصل الزمني (ثوانٍ)';

  @override
  String get fastestIntervalLabel => 'أسرع فاصل زمني (ثوانٍ)';

  @override
  String get distanceLabel => 'المسافة (أمتار)';

  @override
  String get angleLabel => 'الزاوية (درجات)';

  @override
  String get heartbeatLabel => 'نبض الثبات (ثوانٍ)';

  @override
  String get bufferLabel => 'تخزين مؤقت دون اتصال';

  @override
  String get wakelockLabel => 'قفل التنبيه';

  @override
  String get stopDetectionLabel => 'اكتشاف التوقف';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'تتبع مستمر';

  @override
  String get advancedLabel => 'إعدادات متقدمة';

  @override
  String get passwordLabel => 'كلمة المرور';

  @override
  String get optimizationMessage =>
      'لضمان تتبع موثوق، يرجى تعطيل تحسين البطارية لهذا التطبيق.';

  @override
  String get passwordError => 'كلمة المرور خاطئة';

  @override
  String get startAction => 'بدء الخدمة';

  @override
  String get stopAction => 'إيقاف الخدمة';

  @override
  String get sosAction => 'ارسال استغاثة';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}

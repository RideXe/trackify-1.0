// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Korean (`ko`).
class AppLocalizationsKo extends AppLocalizations {
  AppLocalizationsKo([String locale = 'ko']) : super(locale);

  @override
  String get trackingTitle => '추적';

  @override
  String get settingsTitle => '설정';

  @override
  String get statusTitle => '로그';

  @override
  String get saveButton => '저장';

  @override
  String get cancelButton => '취소';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => '위치 전송';

  @override
  String get statusButton => '상태 보기';

  @override
  String get settingsButton => '설정 변경';

  @override
  String get invalidValue => '잘못된 값';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => '기기 식별자';

  @override
  String get urlLabel => '서버 URL';

  @override
  String get accuracyLabel => '위치 정확도';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => '높음';

  @override
  String get mediumAccuracyLabel => '보통';

  @override
  String get lowAccuracyLabel => '낮음';

  @override
  String get intervalLabel => '간격 (초)';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => '거리 (미터)';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => '오프라인 버퍼링';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => '지속 추적';

  @override
  String get advancedLabel => 'Advanced settings';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'To ensure reliable tracking, please disable battery optimization for this app.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => '서비스 시작';

  @override
  String get stopAction => '서비스 중지';

  @override
  String get sosAction => 'SOS 전송';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}

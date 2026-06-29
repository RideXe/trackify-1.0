// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Japanese (`ja`).
class AppLocalizationsJa extends AppLocalizations {
  AppLocalizationsJa([String locale = 'ja']) : super(locale);

  @override
  String get trackingTitle => '追跡';

  @override
  String get settingsTitle => '設定';

  @override
  String get statusTitle => 'ログ';

  @override
  String get saveButton => '保存';

  @override
  String get cancelButton => 'キャンセル';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => '位置情報を送信';

  @override
  String get statusButton => 'ステータスを表示';

  @override
  String get settingsButton => '設定を変更';

  @override
  String get invalidValue => '無効な値';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => 'デバイス識別子';

  @override
  String get urlLabel => 'サーバーURL';

  @override
  String get accuracyLabel => '位置精度';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => '高';

  @override
  String get mediumAccuracyLabel => '中';

  @override
  String get lowAccuracyLabel => '低';

  @override
  String get intervalLabel => '間隔（秒）';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => '距離（メートル）';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'オフラインバッファリング';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => '継続追跡';

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
  String get startAction => 'サービス開始';

  @override
  String get stopAction => 'サービス停止';

  @override
  String get sosAction => 'SOSを送信';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}

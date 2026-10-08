import Foundation
import Speech

let args = CommandLine.arguments
if args.count < 2 { FileHandle.standardError.write(Data("usage: speech-transcribe <wav> [lang]".utf8)); exit(2) }
let url = URL(fileURLWithPath: args[1])
let hint = args.count >= 3 ? args[2] : ""

func pickLocale(_ hint: String) -> Locale {
  let supported = SFSpeechRecognizer.supportedLocales()
  if !hint.isEmpty, let m = supported.first(where: { $0.language.languageCode?.identifier == hint }) { return m }
  if supported.contains(Locale.current) { return Locale.current }
  return Locale(identifier: "en-US")
}

let authSem = DispatchSemaphore(value: 0)
var authorized = false
SFSpeechRecognizer.requestAuthorization { status in authorized = (status == .authorized); authSem.signal() }
authSem.wait()
if !authorized { FileHandle.standardError.write(Data("speech authorization not granted".utf8)); exit(3) }

let locale = pickLocale(hint)
guard let rec = SFSpeechRecognizer(locale: locale), rec.isAvailable else { FileHandle.standardError.write(Data(("recognizer unavailable for " + locale.identifier).utf8)); exit(4) }
rec.defaultTaskHint = .dictation
let req = SFSpeechURLRecognitionRequest(url: url)
req.shouldReportPartialResults = false
req.addsPunctuation = true
if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }

let done = DispatchSemaphore(value: 0)
var code: Int32 = 0
rec.recognitionTask(with: req) { result, error in
  if let error = error { FileHandle.standardError.write(Data(("recognition error: " + error.localizedDescription).utf8)); code = 5; done.signal(); return }
  guard let result = result, result.isFinal else { return }
  var words: [[String: Any]] = []
  for seg in result.bestTranscription.segments {
    let w = seg.substring.trimmingCharacters(in: .whitespaces)
    if w.isEmpty { continue }
    let conf = Double(seg.confidence)
    words.append(["word": w, "start": seg.timestamp, "end": seg.timestamp + seg.duration, "probability": conf > 0 ? min(1.0, conf) : 0.8])
  }
  let out: [String: Any] = ["language": locale.identifier, "words": words]
  if let data = try? JSONSerialization.data(withJSONObject: out) { FileHandle.standardOutput.write(data) }
  done.signal()
}
done.wait()
exit(code)

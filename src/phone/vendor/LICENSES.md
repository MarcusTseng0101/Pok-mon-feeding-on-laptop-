# src/phone/vendor：手機頁面辨識照片用的第三方檔案

只給手機頁面用（`src/phone/snap.js`）。電腦上的 app 只負責把這些檔案原樣送給手機（`src/main/phone.js` 的 `VENDOR` 白名單），
`src/main`、`src/renderer`、`src/core` 都不 import 這裡的任何東西。沒有加進 `package.json`。

照片只在手機上辨識，不送到任何地方；這些檔案也不連任何外部網址（模型從同一個小網站讀）。

## 檔案、來源、版本

| 檔案 | 來源 | 版本 | 授權 |
|---|---|---|---|
| `tf-core.min.js` | https://registry.npmjs.org/@tensorflow/tfjs-core/-/tfjs-core-4.22.0.tgz 裡的 `dist/tf-core.min.js` | 4.22.0 | Apache-2.0 |
| `tf-converter.min.js` | https://registry.npmjs.org/@tensorflow/tfjs-converter/-/tfjs-converter-4.22.0.tgz 裡的 `dist/tf-converter.min.js` | 4.22.0 | Apache-2.0 |
| `tf-backend-cpu.min.js` | https://registry.npmjs.org/@tensorflow/tfjs-backend-cpu/-/tfjs-backend-cpu-4.22.0.tgz 裡的 `dist/tf-backend-cpu.min.js` | 4.22.0 | Apache-2.0 |
| `tf-backend-webgl.min.js` | https://registry.npmjs.org/@tensorflow/tfjs-backend-webgl/-/tfjs-backend-webgl-4.22.0.tgz 裡的 `dist/tf-backend-webgl.min.js` | 4.22.0 | Apache-2.0 |
| `coco-ssd.min.js` | https://registry.npmjs.org/@tensorflow-models/coco-ssd/-/coco-ssd-2.2.3.tgz 裡的 `dist/coco-ssd.min.js` | 2.2.3 | Apache-2.0 |
| `model.json`、`group1-shard1of5`～`group1-shard5of5` | https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/ （coco-ssd 2.2.3 的 `lite_mobilenet_v2` 預設讀的模型；由 TensorFlow Object Detection API 的 SSDLite MobileNet v2 轉換） | coco-ssd 2.2.3 使用的版本 | Apache-2.0 |

原始碼：https://github.com/tensorflow/tfjs（tfjs-core、tfjs-converter、tfjs-backend-cpu、tfjs-backend-webgl）、
https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd 。每個 `.min.js` 開頭保留原本的版權聲明。
沒有修改任何檔案。

## SHA-256

```
8875b8c1bb57723990c9d6506226e0e51cd21b8b6943eb53201086096de52df5  coco-ssd.min.js
0e7af0f713e98521252321f7f84892c31cefccccec3ac64c84e5065b75ed5646  group1-shard1of5
74cc6cfc2c4510c9cd81b8ad4cebf6f6a8f305119bb365ce0eb96276da38519a  group1-shard2of5
50383033f893eae136392a403e8f70ade5efd90867df5695c4ca5ac640e14f38  group1-shard3of5
d856dc534c780068bbf6c666ce1516df2c8433d87578aa31fcdf197de7058cc2  group1-shard4of5
3d356f1fb6dfca6af78c56db34d9326706d0196e303f9de6b04f236ca79ed309  group1-shard5of5
3770b2528339b1e3340cb74360e1e40401816b009779aeb8d0cce3a4353ea3a9  model.json
4f232e90455e04cc5f69a691295d07a881a4ad93d7f229598459b9b533259d83  tf-backend-cpu.min.js
b41fcbb4aee7721af0cc77ecfede60b44ad4ed6d5782a8392b84f774f4359a45  tf-backend-webgl.min.js
0cf35a2982b637997e8cae097c991c0123b7d5393b3d45730aa732b907c6cd1b  tf-converter.min.js
0924438788ff7da57b14d0f7c45a05d81611a5a4b52653da6d065e86d348757c  tf-core.min.js
```

## Apache License 2.0 全文

```

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

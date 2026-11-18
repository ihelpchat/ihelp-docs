# Mapa estático do produto v2

Front: `84755969b9b54caa044da6a70b2cdba35eca78ec`, extraído por `git archive` do HEAD de `/Users/bruno/orca/workspaces/ihelp-react/widget-tour-release-1211` no início da geração. Alterações não commitadas ficaram fora.
Backend: `71f8201dcc027b1f4b1c5266b3976a8001ae80a0`, o mesmo commit do snapshot aprovado anterior, extraído por `git archive` de `/Users/bruno/orca/workspaces/olah-ihelp/m8-1c-executor-pos-efeito`.

schemaVersion: 2 no envelope e no manifesto. Catálogos routes, labels, markers e permissions preservados no formato existente.

- Rotas: 63.
- Elementos (ocorrências por rota + compartilhados): 3677; com nome: 2215 (60.24%).
- Com rota: 2769; compartilhados sem rota comprovada: 908.
- Sem nome: 1462 ocorrências, em 747 posições de código únicas.
- Rotas com pelo menos um kind+name ambíguo: 40.

## Ambiguidade por rota — top 10

| Rota | Pares kind+name repetidos | Elementos envolvidos |
| --- | ---: | ---: |
| /atendimento | 32 | 100 |
| /crm/pipeline | 12 | 35 |
| /crm/pipeline/:funnelIdRef | 12 | 35 |
| /contact/detail/:idRef | 11 | 25 |
| /crm/card/:cardId | 11 | 37 |
| /profile | 6 | 16 |
| /track | 5 | 11 |
| /track/acompanhamento | 5 | 11 |
| /bot/:id | 4 | 10 |
| /campanhas | 4 | 8 |

## Contrato e limites

elementsForRoutes aceita o manifesto ou o envelope approved.json, devolve somente elementos das rotas pedidas presentes no catálogo e exclui shared sem rota. resolveLocator exige rota catalogada, kind e nome exatos; nomes vazios e alvos ausentes retornam missing; múltiplas ocorrências retornam ambiguous; rota desconhecida retorna route. within: "dialog" filtra inModal; containers arbitrários retornam missing porque o estático não comprova sua identidade.

As rotas partem dos objetos de pagesData e do registry de configurações (sections + elements, incluindo lazy imports). Imports JSX locais/@ e reexports por nome conectam os componentes às telas; componentes sem conexão comprovada ficam route:null/shared:true. source é file:line, column distingue elementos na mesma linha. duplicates conta ocorrências estáticas com mesmo kind+name na rota, incluindo a própria ocorrência; sem nome/rota recebe 0.

O vocabulário de controles é conservador: wrappers de layout não viram botões apenas pelo prefixo do nome. O inventário conta ocorrências JSX reconhecidas, não nós do DOM. Este é um mapa estático: condicionais podem listar alternativas que nunca aparecem juntas, loops/dados dinâmicos não têm multiplicidade em runtime e arquivos que declaram vários componentes podem produzir candidatos conservadores. inModal usa nomes Modal/Dialog/Drawer/Sidebar e herança de imports; não comprova que o modal está aberto. Nenhum elemento recebeu verificação de visibilidade em runtime. O crawl autenticado fica para a próxima etapa.

A ausência de nome pode indicar props dinâmicas, labels externos ou wrappers genéricos, além de falhas reais de acessibilidade. A lista abaixo agrupa a mesma posição de código e informa quantas rotas a alcançam; não sugere adicionar aria-label indiscriminadamente.

ButtonIconAction sem nome: 41 ocorrências em 28 posições únicas.

## Elementos sem nome — posições únicas

| Origem | Componente | Kind | Rotas |
| --- | --- | --- | ---: |
| src/components/Chat/components/MessageInteractiveList/index.tsx:39:9 | MenuButton | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/ActivitiesList.tsx:228:13 | h3 | heading | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Calls/CallTimelineItem.tsx:107:17 | button | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Calls/CallTimelineItem.tsx:75:11 | h4 | heading | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Notes/AddNoteForm.tsx:269:15 | input | field | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Notes/AddNoteForm.tsx:278:17 | button | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Notes/AddNoteForm.tsx:287:17 | button | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Notes/NotesTimelineSection.tsx:31:7 | button | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Notes/NoteTimelineItem.tsx:32:9 | a | link | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Notes/NoteTimelineItem.tsx:51:7 | a | link | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Notes/NoteTimelineItem.tsx:78:13 | h4 | heading | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/ScheduledMessages/index.tsx:80:17 | h3 | heading | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/ScheduledMessages/ScheduledMessageTimelineItem.tsx:184:15 | h4 | heading | 1 |
| src/components/pages/Contacts/ContactsDetail/components/Activities/Tasks/index.tsx:202:7 | button | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/ActivitySection.tsx:30:7 | button | button | 0 |
| src/components/pages/Contacts/ContactsDetail/components/ActivitySection.tsx:34:9 | h3 | heading | 0 |
| src/components/pages/Contacts/ContactsDetail/components/ContactActivities.tsx:147:17 | button | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/ContactInformations.tsx:491:21 | button | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/OwnerField/index.tsx:271:17 | button | button | 1 |
| src/components/pages/Contacts/ContactsDetail/components/OwnerField/index.tsx:281:17 | button | button | 1 |
| src/components/pages/Contacts/ContactsList/components/ContactTableRow.tsx:122:15 | button | button | 1 |
| src/components/pages/Contacts/ContactsList/components/ContactTableRow.tsx:132:15 | button | button | 1 |
| src/components/pages/Contacts/ContactsList/components/ContactTableRow.tsx:62:11 | input | field | 1 |
| src/components/pages/Contacts/ContactsList/components/CreateContactModal/index.tsx:233:29 | InputContact | field | 2 |
| src/components/pages/Contacts/ContactsList/components/ImportContactsModal/index.tsx:392:29 | input | field | 1 |
| src/components/pages/Contacts/ContactsList/components/ImportContactsModal/index.tsx:478:37 | input | field | 1 |
| src/components/pages/Contacts/ContactsList/components/ImportContactsModal/index.tsx:544:31 | select | field | 1 |
| src/components/pages/Contacts/ContactsList/index.tsx:134:17 | MenuItem | menuitem | 1 |
| src/components/pages/Contacts/ContactsList/index.tsx:149:17 | MenuItem | menuitem | 1 |
| src/components/pages/Robots/components/HeaderPageById/MenuBotVersions/index.tsx:135:21 | button | button | 1 |
| src/components/pages/Robots/components/TabsRobotsById/index.tsx:134:9 | Select | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabConfiguration/index.tsx:358:17 | InputSlider | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabConfiguration/index.tsx:387:15 | SelectCommon | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabConfiguration/index.tsx:425:17 | SelectCommon | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepActions/components/StepServiceFollow/index.tsx:170:15 | input | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepActions/components/StepServiceFollow/index.tsx:195:11 | SelectCommon | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepActions/components/StepSetPriority/index.tsx:170:15 | input | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepActions/components/StepSetPriority/index.tsx:195:11 | SelectCommon | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepBlockIntegration/components/DualInputWithArrow/index.tsx:40:9 | InputText | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepBlockIntegration/components/DualInputWithArrow/index.tsx:58:9 | InputText | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepBlockIntegration/components/StepAddVariables/index.tsx:361:19 | ButtonWithIcon | button | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepBlockMessageSample/components/ModalAddInterval/index.tsx:144:2 | InputText | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/Steps/StepBlockMessageSample/components/ModalAddInterval/index.tsx:160:2 | SelectCommon | field | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/components/SideBar/components/TransitionLayout/index.tsx:25:7 | button | button | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/index.tsx:210:13 | button | button | 1 |
| src/components/pages/Robots/pages/RobotById/components/TabFluxBot/nodes/SelectNode/index.tsx:93:14 | SelectCommon | field | 0 |
| src/components/pages/Robots/pages/RobotById/components/TableContactsByRobotId/index.tsx:213:25 | a | link | 1 |
| src/components/pages/Robots/pages/RobotById/components/TableContactsByRobotId/index.tsx:223:25 | a | link | 1 |
| src/components/pages/Robots/pages/RobotById/components/TableContactsByRobotId/index.tsx:234:27 | a | link | 1 |
| src/components/pages/Robots/pages/TabListRobots/components/TabsRobots/index.tsx:28:9 | Select | field | 1 |
| src/components/shared/Attendance/components/AttendanceButtonSelectAll/index.tsx:24:7 | InputCheckbox | field | 1 |
| src/components/shared/Attendance/components/AttendanceCard/components/ContentInfoLeft/index.tsx:70:11 | InputMaskCheckBox | field | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatAttachment/index.tsx:169:7 | input | field | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatHeader/components/AttendanceTasksPopover/index.tsx:151:17 | button | button | 0 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatHeader/components/AttendanceTasksPopover/index.tsx:196:19 | InputCheckbox | field | 0 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatHeader/components/AttendanceTasksPopover/index.tsx:201:19 | button | button | 0 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatHeader/components/HeaderOverflowMenu/index.tsx:135:7 | button | button | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatHeader/components/HeaderOverflowMenu/index.tsx:164:17 | button | button | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatHeader/components/HeaderOverflowMenu/index.tsx:197:19 | button | menuitem | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatMessage/components/ButtonAttachment/index.tsx:86:7 | input | field | 4 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatMessage/components/ButtonAttachment/index.tsx:96:13 | input | field | 4 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatMessage/components/ButtonSend/index.tsx:74:9 | MenuItem | menuitem | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatMessage/components/ButtonSend/index.tsx:85:9 | MenuItem | menuitem | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatMessage/index.tsx:1288:13 | button | button | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceChatMessage/index.tsx:1296:13 | button | button | 1 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceShortCuts/index.tsx:241:13 | ButtonIconAction | button | 4 |
| src/components/shared/Attendance/components/AttendanceChat/AttendanceShortCuts/index.tsx:272:19 | ButtonIconAction | button | 4 |
| src/components/shared/Attendance/components/AttendanceContactSaveFlow/AttendanceContactSaveFlow.integration.test.tsx:42:12 | input | field | 0 |
| src/components/shared/Attendance/components/AttendanceMarker/components/MarkersAndSearch/index.tsx:143:15 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/components/AttendanceMarker/components/MarkersAndSearch/index.tsx:157:15 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/components/AttendanceNotices/index.tsx:187:35 | Link | link | 0 |
| src/components/shared/Attendance/components/AttendanceNotices/index.tsx:189:49 | Link | link | 0 |
| src/components/shared/Attendance/components/AttendanceSearchContacts/index.tsx:29:13 | Link | link | 1 |
| src/components/shared/Attendance/components/ChatMessageRecovery/index.tsx:116:3 | button | button | 1 |
| src/components/shared/Attendance/core/AttendanceSidebarLayout/components/AttendanceSidebar/components/AttendanceSidebarRoot/components/AttendanceSidebarHeader/index.tsx:26:11 | Title | heading | 0 |
| src/components/shared/Attendance/core/AttendanceSidebarLayout/components/AttendanceSidebar/components/sections/AttendanceSidebarNewAttendance/index.tsx:1083:27 | InputContactOrNumber | field | 3 |
| src/components/shared/Attendance/core/AttendanceSidebarLayout/components/AttendanceSidebar/components/sections/AttendanceSidebarScheduleAttendance/index.tsx:848:21 | InputDate | field | 3 |
| src/components/shared/Attendance/core/AttendanceSidebarLayout/components/AttendanceSidebar/components/sections/AttendanceSidebarScheduleAttendance/index.tsx:856:21 | InputTime | field | 3 |
| src/components/shared/Attendance/core/AttendanceSidebarLayout/components/AttendanceSidebar/components/sections/AttendanceSidebarScheduleAttendance/index.tsx:879:23 | Title | heading | 3 |
| src/components/shared/Attendance/core/AttendanceSidebarLayout/components/AttendanceSidebar/components/sections/AttendanceSidebarTransferAttendance/index.tsx:381:21 | InputCheckbox | field | 3 |
| src/components/shared/Attendance/sections/components/AttendanceSectionChat/components/AttendanceNextUp/index.tsx:122:7 | h2 | heading | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionChat/components/AttendanceNextUp/index.tsx:302:7 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionChat/components/AttendanceNextUp/index.tsx:337:7 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionChat/components/AttendanceNextUp/index.tsx:402:11 | h2 | heading | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionChat/components/AttendanceNextUp/index.tsx:442:13 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionChat/components/AttendanceNextUp/index.tsx:511:21 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionChat/components/AttendanceSectionChatView/components/MessageWrapperList/components/MessageItem/index.tsx:560:9 | InputCheckbox | field | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionChat/components/AttendanceSectionChatView/components/MessageWrapperList/components/MessageItem/index.tsx:693:21 | a | link | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceCrmTab/CrmOpportunityCard.proposalLock.test.tsx:13:7 | button | button | 0 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceCrmTab/CrmOpportunityCard.test.tsx:32:9 | button | button | 0 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceCrmTab/CrmOpportunityCard.test.tsx:41:15 | button | menuitem | 0 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceCrmTab/index.test.tsx:178:9 | button | button | 0 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceCrmTab/index.test.tsx:237:9 | button | button | 0 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceCrmTab/index.test.tsx:242:9 | button | button | 0 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceTasksCard/index.tsx:142:13 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceTasksCard/index.tsx:171:15 | InputCheckbox | field | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionDetails/components/AttendanceTasksCard/index.tsx:182:15 | button | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionFavoriteTabs/components/AttendanceSectionFavoriteTabsView/index.tsx:52:13 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionFavoriteTabs/components/AttendanceSectionFavoriteTabsView/index.tsx:77:38 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionFavoriteTabs/components/AttendanceSectionFavoriteTabsView/index.tsx:78:40 | ButtonIconAction | button | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionList/components/AttendanceList/components/AttendanceSectionHeader/index.tsx:109:5 | Header | heading | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionList/components/AttendanceSectionListView/components/AttendanceQueueEmptyState/index.tsx:48:7 | h3 | heading | 1 |
| src/components/shared/Attendance/sections/components/AttendanceSectionList/components/AttendanceSectionSearchAndFilters/components/AttendanceFilterAndOrder/components/AttendanceFilter/componentes/MenuFilter/components/MenuFilterAction/components/Wrapper/index.tsx:23:5 | MenuItem | menuitem | 0 |
| src/components/shared/Attendance/sections/components/AttendanceSectionList/components/AttendanceSectionSearchAndFilters/components/AttendanceFilterAndOrder/components/AttendanceFilter/componentes/MenuFilter/index.tsx:37:5 | MenuItem | menuitem | 0 |
| src/components/shared/Chat/components/AttachmentMenu/index.tsx:27:5 | MenuButton | button | 4 |
| src/components/shared/Chat/components/AttachmentMenu/index.tsx:45:9 | MenuItem | menuitem | 4 |
| src/components/shared/Chat/components/AttachmentMenu/index.tsx:46:11 | button | button | 4 |
| src/components/shared/Chat/components/ButtonShortCut/index.tsx:43:5 | Button | button | 4 |
| src/components/shared/Chat/components/ChatView/index.tsx:412:19 | InputTextArea | field | 4 |
| src/components/shared/Chat/components/EmojiSelector/EmojiLibrary.test.tsx:122:12 | Selector | field | 0 |
| src/components/shared/Chat/components/EmojiSelector/EmojiLibrary.test.tsx:132:34 | Selector | field | 0 |
| src/components/shared/Chat/components/EmojiSelector/EmojiLibrary.test.tsx:147:34 | Selector | field | 0 |
| src/components/shared/Chat/components/EmojiSelector/index.tsx:120:15 | ButtonIconAction | button | 4 |
| src/components/shared/Chat/components/MessageDocument/index.tsx:143:13 | DialogTitle | heading | 4 |
| src/components/shared/Chat/components/MessageDocument/index.tsx:347:13 | button | button | 4 |
| src/components/shared/Chat/components/MessageText/LinkifiedText.tsx:32:11 | a | link | 4 |
| src/components/shared/Chat/components/MessageTranscriber/index.tsx:88:9 | TextArea | field | 1 |
| src/components/shared/Chat/components/PendingAttachmentBar/index.tsx:55:5 | button | button | 1 |
| src/components/shared/ColorPicker/index.tsx:52:11 | Color | button | 1 |
| src/components/shared/DropdownAgents/AgentsAndSearch/index.tsx:103:17 | SelectionBox | field | 1 |
| src/components/shared/NotFoundPage/index.tsx:77:15 | Link | link | 4 |
| src/components/shared/QrConexao/HistorySyncBox/index.tsx:55:9 | InputCheckbox | field | 1 |
| src/components/shared/ScheduledMessages/components/ScheduledMessageItem.tsx:121:11 | h3 | heading | 0 |
| src/components/shared/SelectEntities/components/SelectAttendanceStatus/components/OptionSelect/index.tsx:25:7 | Title | heading | 0 |
| src/components/shared/SelectEntities/components/SelectAttendanceStatus/components/OptionSelect/index.tsx:29:9 | Selected | field | 0 |
| src/components/shared/SelectEntities/components/SelectAttendanceStatus/index.tsx:28:7 | Select | field | 0 |
| src/components/shared/SelectEntities/components/SelectChannels/components/OptionSelectChannel/index.tsx:26:7 | Title | heading | 0 |
| src/components/shared/SelectEntities/components/SelectChannels/components/OptionSelectChannel/index.tsx:33:9 | Selected | field | 0 |
| src/components/shared/SelectEntities/components/SelectChannels/index.tsx:172:13 | Select | field | 3 |
| src/components/shared/SelectEntities/components/SelectChannels/index.tsx:183:13 | Select | field | 3 |
| src/components/shared/SelectEntities/components/SelectChannels/index.tsx:194:13 | SelectTemplatesApiOfficial | field | 3 |
| src/components/shared/SelectEntities/components/SelectChannels/index.tsx:199:13 | SelectTemplatesApiOfficial | field | 3 |
| src/components/shared/SelectEntities/components/SelectClosingReasons/closingSearch.test.tsx:18:10 | SelectClosingReasons | field | 0 |
| src/components/shared/SelectEntities/components/SelectClosingReasons/closingSearch.test.tsx:53:10 | SelectClosingReasons | field | 0 |
| src/components/shared/SelectEntities/components/SelectClosingReasons/closingSearch.test.tsx:69:10 | SelectClosingReasons | field | 0 |
| src/components/shared/SelectEntities/components/SelectClosingReasons/index.tsx:26:7 | SelectCommon | field | 0 |
| src/components/shared/SelectEntities/components/SelectClosingReasons/SelectClosingReasons.visual.test.tsx:28:10 | SelectClosingReasons | field | 0 |
| src/components/shared/SelectEntities/components/SelectDepartments/index.tsx:74:9 | Select | field | 3 |
| src/components/shared/SelectEntities/components/SelectDepartments/index.tsx:78:9 | Select | field | 3 |
| src/components/shared/SelectEntities/components/SelectTags/components/OptionSelect/index.tsx:25:7 | Title | heading | 0 |
| src/components/shared/SelectEntities/components/SelectTags/components/OptionSelect/index.tsx:31:9 | Selected | field | 0 |
| src/components/shared/SelectEntities/components/SelectTags/index.tsx:28:7 | Select | field | 0 |
| src/components/shared/SelectEntities/components/SelectTemplatesApiOfficial/components/OptionSelectChannel/index.tsx:26:7 | Title | heading | 0 |
| src/components/shared/SelectEntities/components/SelectTemplatesApiOfficial/components/OptionSelectChannel/index.tsx:31:9 | Selected | field | 0 |
| src/components/shared/SelectEntities/components/SelectTemplatesApiOfficial/index.tsx:89:9 | Select | field | 3 |
| src/components/shared/SelectEntities/components/SelectTemplatesApiOfficial/index.tsx:93:9 | Select | field | 3 |
| src/components/shared/SelectEntities/components/SelectUsers/components/OptionSelect/index.tsx:25:7 | Title | heading | 0 |
| src/components/shared/SelectEntities/components/SelectUsers/components/OptionSelect/index.tsx:29:9 | Selected | field | 0 |
| src/components/shared/SelectEntities/components/SelectUsers/index.tsx:28:7 | Select | field | 0 |
| src/components/ui/components/Avatars/AvatarInitials/AvatarInitials.test.tsx:22:7 | button | button | 0 |
| src/components/ui/components/Banners/NoticeBanner/atoms.tsx:131:9 | button | button | 1 |
| src/components/ui/components/Banners/NoticeBanner/atoms.tsx:77:7 | a | link | 1 |
| src/components/ui/components/Banners/NoticeBanner/atoms.tsx:91:5 | button | button | 1 |
| src/components/ui/components/Banners/NoticeBanner/index.tsx:216:13 | Title | heading | 1 |
| src/components/ui/components/BaseModal/index.tsx:183:17 | DialogTitle | heading | 20 |
| src/components/ui/components/BaseModal/index.tsx:198:19 | DialogTitle | heading | 20 |
| src/components/ui/components/button.tsx:13:7 | button | button | 1 |
| src/components/ui/components/Buttons/ButtonIconAction/index.tsx:127:7 | button | button | 24 |
| src/components/ui/components/Buttons/ButtonIconAction/index.tsx:78:9 | a | link | 24 |
| src/components/ui/components/Buttons/ButtonIconBack/index.tsx:22:5 | button | button | 4 |
| src/components/ui/components/Buttons/ButtonWithIcon/index.tsx:27:7 | Button | button | 24 |
| src/components/ui/components/Buttons/ButtonWithoutIcon/index.tsx:23:5 | Button | button | 8 |
| src/components/ui/components/Buttons/ComposerIconButton/index.tsx:21:5 | button | button | 4 |
| src/components/ui/components/Calendar/index.tsx:138:13 | Button | button | 1 |
| src/components/ui/components/Calendar/index.tsx:144:13 | Button | button | 1 |
| src/components/ui/components/Calendar/index.tsx:151:11 | h2 | heading | 1 |
| src/components/ui/components/Calendar/index.tsx:94:9 | Button | button | 1 |
| src/components/ui/components/Chip/index.tsx:237:9 | button | button | 4 |
| src/components/ui/components/ConfirmationDialog/components/ConfirmDialogHost/index.tsx:114:7 | input | field | 1 |
| src/components/ui/components/ConfirmationDialog/components/ConfirmDialogHost/index.tsx:81:5 | button | button | 1 |
| src/components/ui/components/ConfirmationDialog/components/ConfirmDialogHost/index.tsx:97:5 | button | button | 1 |
| src/components/ui/components/ConfirmationDialog/index.tsx:40:2 | h3 | heading | 2 |
| src/components/ui/components/ConfirmationDialog/index.tsx:42:2 | button | button | 2 |
| src/components/ui/components/ConfirmationDialog/index.tsx:52:2 | button | button | 2 |
| src/components/ui/components/ConfirmationDialog/index.tsx:59:2 | button | button | 2 |
| src/components/ui/components/CopyToClipboardPhone.tsx:41:5 | span | button | 0 |
| src/components/ui/components/DateRangePicker/index.tsx:289:17 | button | button | 4 |
| src/components/ui/components/DetailPageHeader/index.tsx:43:9 | button | button | 0 |
| src/components/ui/components/DetailPageHeader/index.tsx:54:15 | button | button | 0 |
| src/components/ui/components/DetailPageHeader/index.tsx:71:13 | h1 | heading | 0 |
| src/components/ui/components/DetailPageHeader/index.tsx:82:15 | button | button | 0 |
| src/components/ui/components/Drawer/index.tsx:108:19 | DialogTitle | heading | 4 |
| src/components/ui/components/Dropdowns/DropdownMenu/ContextMenu.tsx:114:2 | MenuItem | menuitem | 6 |
| src/components/ui/components/Dropdowns/DropdownMenu/ContextMenu.tsx:116:2 | button | button | 6 |
| src/components/ui/components/Dropdowns/DropdownMenu/ContextMenu.tsx:155:2 | MenuItem | menuitem | 6 |
| src/components/ui/components/Dropdowns/DropdownMenu/ContextMenu.tsx:157:2 | button | button | 6 |
| src/components/ui/components/Dropdowns/DropdownMenu/ContextMenu.tsx:59:2 | MenuButton | button | 6 |
| src/components/ui/components/Dropdowns/DropdownMenu/index.tsx:44:9 | MenuButton | button | 4 |
| src/components/ui/components/Dropdowns/DropdownMenu/index.tsx:80:11 | MenuButton | button | 4 |
| src/components/ui/components/Dropdowns/TitleDropdown/index.tsx:52:7 | button | button | 0 |
| src/components/ui/components/Dropdowns/TitleDropdown/index.tsx:89:19 | button | button | 0 |
| src/components/ui/components/EditableField/index.tsx:244:17 | SelectCommon | field | 5 |
| src/components/ui/components/EditableField/index.tsx:252:17 | SelectCommon | field | 5 |
| src/components/ui/components/EditableField/index.tsx:255:15 | input | field | 5 |
| src/components/ui/components/EditableField/index.tsx:272:15 | input | field | 5 |
| src/components/ui/components/EditableField/index.tsx:345:17 | button | button | 5 |
| src/components/ui/components/EditableField/index.tsx:369:17 | button | button | 5 |
| src/components/ui/components/EmptyData/EmptyDataTables/index.tsx:42:9 | ButtonWithIcon | button | 3 |
| src/components/ui/components/EmptyData/index.tsx:51:7 | h3 | heading | 31 |
| src/components/ui/components/Forms/AudioRecorder/index.tsx:103:13 | button | button | 1 |
| src/components/ui/components/Forms/AudioRecorder/index.tsx:113:13 | button | button | 1 |
| src/components/ui/components/Forms/AudioRecorder/index.tsx:135:9 | button | button | 1 |
| src/components/ui/components/Forms/AudioRecorder/index.tsx:90:9 | button | button | 1 |
| src/components/ui/components/Forms/AudioRecorderChat/Reset-index.tsx:165:9 | button | button | 0 |
| src/components/ui/components/Forms/AudioRecorderChat/Reset-index.tsx:178:13 | button | button | 0 |
| src/components/ui/components/Forms/AudioRecorderChat/Reset-index.tsx:188:13 | button | button | 0 |
| src/components/ui/components/Forms/AudioRecorderChat/Reset-index.tsx:216:9 | button | button | 0 |
| src/components/ui/components/Forms/Checkboxs/CheckboxList/index.tsx:75:13 | input | field | 1 |
| src/components/ui/components/Forms/Checkboxs/CheckboxList/index.tsx:87:13 | button | button | 1 |
| src/components/ui/components/Forms/Inputs/InputContact/index.tsx:15:7 | Input | field | 2 |
| src/components/ui/components/Forms/Inputs/InputDate/index.tsx:37:9 | Input | field | 10 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:105:14 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:116:9 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:129:14 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:139:9 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:150:9 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:163:14 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:176:9 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:192:14 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:204:9 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:243:9 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputMaskCheckBox/InputMaskCheckBoxTest.test.tsx:271:9 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Forms/Inputs/InputPhoneMask/index.tsx:18:5 | Select | field | 4 |
| src/components/ui/components/Forms/Inputs/InputSearch/index.tsx:61:9 | Input | field | 29 |
| src/components/ui/components/Forms/Inputs/InputSearchSmartList/components/ScheduleByLetter/index.tsx:44:7 | Select | field | 0 |
| src/components/ui/components/Forms/Inputs/InputSlider/index.tsx:24:7 | input | field | 1 |
| src/components/ui/components/Forms/Inputs/InputText/index.tsx:39:2 | Input | field | 14 |
| src/components/ui/components/Forms/Inputs/InputTextArea/index.tsx:66:11 | TextArea | field | 12 |
| src/components/ui/components/Forms/Inputs/InputTime/index.tsx:25:7 | Input | field | 6 |
| src/components/ui/components/Forms/Selects/MultiSelectSystem/index.tsx:246:2 | Select | field | 6 |
| src/components/ui/components/Forms/Selects/MultiSelectSystem/index.tsx:335:2 | Select | field | 6 |
| src/components/ui/components/Forms/Selects/SelectCommon/AttendanceSelectCommon.tsx:292:9 | InputSearch | field | 11 |
| src/components/ui/components/Forms/Selects/SelectCommon/index.tsx:24:10 | LegacySelectCommon | field | 11 |
| src/components/ui/components/Forms/Selects/SelectCommon/LegacySelectCommon.tsx:276:21 | SelectDiv | field | 11 |
| src/components/ui/components/Forms/Selects/SelectSystem/index.tsx:223:41 | Select | field | 15 |
| src/components/ui/components/Forms/Selects/SelectSystem/index.tsx:313:21 | Select | field | 15 |
| src/components/ui/components/Forms/Selects/SelectSystem/SelectSystem.test.tsx:18:5 | SelectSystem | field | 0 |
| src/components/ui/components/Forms/Selects/SelectSystem/SelectSystem.test.tsx:76:10 | SelectSystem | field | 0 |
| src/components/ui/components/Forms/Selects/SelectSystem/SelectSystem.test.tsx:85:10 | SelectionHarness | field | 0 |
| src/components/ui/components/Forms/Selects/SelectSystem/SelectSystem.test.tsx:96:10 | SelectionHarness | field | 0 |
| src/components/ui/components/ImageViewer/AttendanceImageViewer.tsx:240:11 | button | button | 4 |
| src/components/ui/components/ImageViewer/LegacyImageViewer.tsx:175:17 | button | button | 4 |
| src/components/ui/components/ImageViewer/LegacyImageViewer.tsx:185:17 | button | button | 4 |
| src/components/ui/components/ImageViewer/LegacyImageViewer.tsx:195:17 | button | button | 4 |
| src/components/ui/components/ImageViewer/LegacyImageViewer.tsx:205:17 | button | button | 4 |
| src/components/ui/components/ImageViewer/LegacyImageViewer.tsx:215:17 | button | button | 4 |
| src/components/ui/components/JsonEditor/index.tsx:47:7 | textarea | field | 1 |
| src/components/ui/components/MediaPreview/index.tsx:22:9 | Button | button | 1 |
| src/components/ui/components/Modal/components/ModalAlert/index.tsx:105:19 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/bulkClosing.integration.test.tsx:110:7 | select | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/bulkClosing.integration.test.tsx:82:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/bulkClosing.integration.test.tsx:91:7 | textarea | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingChannelPermission.integration.test.tsx:66:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingChannelPermission.integration.test.tsx:75:7 | textarea | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingOriginalRules.test.tsx:45:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingOriginalRules.test.tsx:50:19 | textarea | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingOriginalRules.test.tsx:56:5 | select | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingSelection.integration.test.tsx:69:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingSelection.integration.test.tsx:78:7 | textarea | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingSelection.integration.test.tsx:97:7 | select | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingStates.test.tsx:36:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingStates.test.tsx:40:19 | textarea | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingStates.test.tsx:44:5 | select | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingToast.integration.test.tsx:111:7 | select | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingToast.integration.test.tsx:83:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/closingToast.integration.test.tsx:92:7 | textarea | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/index.test.tsx:47:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/index.test.tsx:52:19 | textarea | field | 0 |
| src/components/ui/components/Modal/components/ModalAttendanceClosed/index.tsx:368:29 | SelectClosingReasons | field | 0 |
| src/components/ui/components/Modal/components/ModalClosedReasons/components/Collapse/index.tsx:45:13 | InputText | field | 0 |
| src/components/ui/components/Modal/components/ModalClosedReasons/components/Collapse/index.tsx:86:11 | Button | button | 0 |
| src/components/ui/components/Modal/components/ModalConfirm/index.tsx:114:37 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalConfirm/index.tsx:125:37 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalConfirmDepartmentTransferServices/index.tsx:102:2 | SelectCommon | field | 0 |
| src/components/ui/components/Modal/components/ModalConfirmDepartmentTransferServices/index.tsx:123:2 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalCustomizedField/index.tsx:180:31 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalDistribution/componentes/TableDistributionServices/index.tsx:128:27 | InputSlider | field | 0 |
| src/components/ui/components/Modal/components/ModalHistoryChannel/index.tsx:108:17 | SelectCommon | field | 0 |
| src/components/ui/components/Modal/components/ModalHistoryChannel/index.tsx:123:17 | InputDate | field | 0 |
| src/components/ui/components/Modal/components/ModalHistoryChannel/index.tsx:128:17 | InputDate | field | 0 |
| src/components/ui/components/Modal/components/ModalNews/index.tsx:139:21 | button | button | 1 |
| src/components/ui/components/Modal/components/ModalSharedAttendances/components/AttendanceItem/index.tsx:49:9 | InputMaskCheckBox | field | 0 |
| src/components/ui/components/Modal/components/ModalSharedAttendances/forwarding.test.tsx:104:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ModalSharedAttendances/forwarding.test.tsx:113:30 | input | field | 0 |
| src/components/ui/components/Modal/components/ModalSharedAttendances/forwarding.test.tsx:118:5 | button | button | 0 |
| src/components/ui/components/Modal/components/ReasonModal/index.tsx:60:15 | h2 | heading | 3 |
| src/components/ui/components/Modal/components/ReasonModal/index.tsx:91:15 | button | button | 3 |
| src/components/ui/components/Modal/components/ReasonModal/index.tsx:99:15 | ButtonIconAction | button | 3 |
| src/components/ui/components/MultiSelectChip/index.tsx:125:9 | button | button | 1 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:183:11 | MenuButton | button | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:204:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:225:17 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:246:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:261:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:277:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:291:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:379:11 | MenuButton | button | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:393:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:414:17 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:435:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:450:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:466:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/FooterProfile/index.tsx:480:15 | MenuItem | menuitem | 0 |
| src/components/ui/components/NavBar/components/NavigationItems/index.tsx:116:7 | button | button | 0 |
| src/components/ui/components/NavBar/components/NavigationItems/index.tsx:158:9 | button | button | 0 |
| src/components/ui/components/NavBar/components/NavigationItems/index.tsx:216:19 | button | button | 0 |
| src/components/ui/components/NoteComposer/index.tsx:124:13 | input | field | 2 |
| src/components/ui/components/NoteComposer/index.tsx:136:9 | textarea | field | 2 |
| src/components/ui/components/NoteComposer/index.tsx:82:5 | button | button | 2 |
| src/components/ui/components/Notifications/components/Toast/index.tsx:107:21 | button | button | 2 |
| src/components/ui/components/Notifications/components/ToastHost/index.tsx:119:13 | Title | heading | 1 |
| src/components/ui/components/SchedulesList/index.tsx:188:19 | button | button | 1 |
| src/components/ui/components/SchedulesList/index.tsx:194:19 | button | button | 1 |
| src/components/ui/components/SectionCard/index.tsx:55:11 | h3 | heading | 9 |
| src/components/ui/components/SegControl/index.tsx:92:11 | Tab | tab | 15 |
| src/components/ui/components/SettingRow/SettingRow.stories.tsx:46:17 | select | field | 0 |
| src/components/ui/components/Sidebars/ModuleSidebar/index.tsx:45:11 | h2 | heading | 0 |
| src/components/ui/components/Sidebars/ModuleSidebar/index.tsx:57:15 | button | button | 0 |
| src/components/ui/components/Tables/components/TableCommon/components/TableTitle/index.tsx:8:10 | h2 | heading | 0 |
| src/components/ui/components/Tables/components/TableCommon/index.tsx:49:9 | h2 | heading | 0 |
| src/components/ui/components/Tables/components/TableCommon/index.tsx:89:27 | a | link | 0 |
| src/components/ui/components/Tables/components/TableCommon/index.tsx:97:27 | a | link | 0 |
| src/components/ui/components/Tables/components/TableCommonUsers/components/HeaderTable/index.tsx:21:9 | h2 | heading | 0 |
| src/components/ui/components/Tables/components/TableCommonUsers/index.tsx:155:23 | input | field | 0 |
| src/components/ui/components/Tables/components/TableCommonUsers/index.tsx:211:25 | input | field | 0 |
| src/components/ui/components/Tables/components/TableCommonUsers/index.tsx:286:27 | a | link | 0 |
| src/components/ui/components/Tables/components/TableCommonUsers/index.tsx:295:27 | a | link | 0 |
| src/components/ui/components/Tabs/TabsBar.tsx:54:13 | button | button | 0 |
| src/components/ui/components/Tabs/TabsUnderline.tsx:71:13 | button | tab | 2 |
| src/components/ui/components/TagInput/index.tsx:84:9 | SelectCommon | field | 1 |
| src/components/ui/components/TagInput/index.tsx:98:9 | button | button | 1 |
| src/components/ui/components/Tags/TagWord/index.tsx:54:13 | button | button | 0 |
| src/components/ui/components/TagSelectDepartments/index.tsx:110:9 | button | button | 0 |
| src/components/ui/components/TagSelectDepartments/index.tsx:89:11 | SelectCommon | field | 0 |
| src/components/ui/components/Texts/components/H1Title/index.tsx:12:5 | h1 | heading | 4 |
| src/components/ui/components/ValueInput/index.tsx:119:9 | SelectVariant | field | 3 |
| src/components/ui/components/ValueInput/variants.tsx:106:3 | select | field | 3 |
| src/components/ui/components/ValueInput/variants.tsx:199:13 | button | button | 3 |
| src/components/ui/components/ValueInput/variants.tsx:225:11 | select | field | 3 |
| src/components/ui/components/ValueInput/variants.tsx:262:7 | select | field | 3 |
| src/components/ui/components/ValueInput/variants.tsx:33:3 | input | field | 3 |
| src/components/ui/components/ValueInput/variants.tsx:57:5 | input | field | 3 |
| src/components/ui/components/ValueInput/variants.tsx:86:3 | input | field | 3 |
| src/components/ui/components/VariablesMenu/index.tsx:212:21 | button | button | 1 |
| src/components/ui/components/VariablesMenu/index.tsx:240:21 | button | button | 1 |
| src/context/useNotificationToast/closingGroup.provider.test.tsx:16:5 | button | button | 0 |
| src/features/ai/agents/components/AdvancedTab/index.tsx:118:13 | input | field | 0 |
| src/features/ai/agents/components/AdvancedTab/index.tsx:140:13 | input | field | 0 |
| src/features/ai/agents/components/AdvancedTab/index.tsx:162:13 | input | field | 0 |
| src/features/ai/agents/components/AdvancedTab/index.tsx:38:9 | select | field | 0 |
| src/features/ai/agents/components/AdvancedTab/index.tsx:62:9 | input | field | 0 |
| src/features/ai/agents/components/AdvancedTab/index.tsx:86:9 | input | field | 0 |
| src/features/ai/agents/components/AgentCard/index.tsx:101:15 | MenuItem | menuitem | 0 |
| src/features/ai/agents/components/AgentCard/index.tsx:119:17 | MenuItem | menuitem | 0 |
| src/features/ai/agents/components/AgentCard/index.tsx:138:17 | MenuItem | menuitem | 0 |
| src/features/ai/agents/components/AgentCard/index.tsx:157:17 | MenuItem | menuitem | 0 |
| src/features/ai/agents/components/AgentCard/index.tsx:181:9 | h3 | heading | 0 |
| src/features/ai/agents/components/AgentCard/index.tsx:92:11 | MenuButton | button | 0 |
| src/features/ai/agents/components/AgentListFilters/index.tsx:44:7 | select | field | 0 |
| src/features/ai/agents/components/BuilderHeader/index.tsx:62:11 | button | button | 0 |
| src/features/ai/agents/components/ProfileTab/index.tsx:74:15 | input | field | 0 |
| src/features/ai/agents/components/PublishVersionModal/index.tsx:104:17 | input | field | 0 |
| src/features/ai/agents/components/PublishVersionModal/index.tsx:126:15 | button | button | 0 |
| src/features/ai/agents/components/TestChat/index.tsx:186:11 | button | button | 0 |
| src/features/ai/agents/pages/AiLayout.tsx:135:33 | button | button | 0 |
| src/features/auth/components/EmailOtpForm/index.tsx:91:11 | input | field | 0 |
| src/features/auth/components/EmailPasswordForm/index.tsx:207:9 | ButtonWithIcon | button | 0 |
| src/features/auth/components/EmailPasswordForm/index.tsx:220:9 | ButtonWithIcon | button | 0 |
| src/features/auth/components/EmailPasswordForm/index.tsx:85:11 | input | field | 0 |
| src/features/auth/components/ForgotPasswordEmailForm/index.tsx:91:11 | input | field | 0 |
| src/features/auth/components/OtpCodeInput/index.tsx:219:11 | input | field | 1 |
| src/features/campaigns/components/CampaignCard/index.tsx:39:5 | div | button | 1 |
| src/features/campaigns/components/CampaignCard/index.tsx:48:9 | h3 | heading | 1 |
| src/features/campaigns/components/CampaignContactsTable/index.tsx:144:9 | h3 | heading | 1 |
| src/features/campaigns/components/CampaignContactsTable/index.tsx:162:11 | select | field | 1 |
| src/features/campaigns/components/CampaignFilters/index.tsx:46:11 | select | field | 1 |
| src/features/campaigns/components/CampaignListItem/index.tsx:39:5 | div | button | 1 |
| src/features/campaigns/components/CampaignListItem/index.tsx:49:9 | h3 | heading | 1 |
| src/features/campaigns/components/CampaignWizardFooter/index.tsx:24:7 | button | button | 1 |
| src/features/campaigns/components/StepImport/index.tsx:299:9 | input | field | 1 |
| src/features/campaigns/components/StepMessage/index.tsx:356:21 | button | button | 1 |
| src/features/campaigns/components/StepMessage/index.tsx:399:13 | input | field | 1 |
| src/features/campaigns/components/StepMessage/index.tsx:488:13 | InputDate | field | 1 |
| src/features/campaigns/components/StepMessage/index.tsx:498:13 | InputTime | field | 1 |
| src/features/campaigns/components/StepMessage/index.tsx:522:17 | InputTime | field | 1 |
| src/features/campaigns/components/StepMessage/index.tsx:532:17 | InputTime | field | 1 |
| src/features/campaigns/components/StepMessage/index.tsx:550:13 | input | field | 1 |
| src/features/campaigns/components/StepParametrize/index.tsx:148:23 | input | field | 1 |
| src/features/campaigns/components/StepReview/index.tsx:217:15 | InputText | field | 1 |
| src/features/configurations/checks/PageChecks.tsx:88:15 | button | button | 4 |
| src/features/configurations/components/BuscaEmLista.tsx:67:9 | InputSearch | field | 12 |
| src/features/configurations/components/Hora.tsx:33:3 | input | field | 3 |
| src/features/configurations/components/MultiSelect.tsx:114:7 | button | button | 4 |
| src/features/configurations/components/MultiSelect.tsx:155:19 | button | button | 4 |
| src/features/configurations/components/MultiSelect.tsx:168:19 | button | button | 4 |
| src/features/configurations/components/MultiSelect.tsx:178:21 | input | field | 4 |
| src/features/configurations/components/PaginacaoNumerada.tsx:74:5 | button | button | 1 |
| src/features/configurations/components/Select.tsx:26:5 | select | field | 7 |
| src/features/configurations/components/SelectUnico.tsx:126:17 | button | button | 8 |
| src/features/configurations/components/SelectUnico.tsx:88:7 | button | button | 8 |
| src/features/configurations/layout/ConfigLayout.tsx:96:19 | h2 | heading | 1 |
| src/features/configurations/layout/ConfigPageHeader.tsx:41:9 | button | button | 4 |
| src/features/configurations/layout/ConfigPageHeader.tsx:53:9 | h2 | heading | 4 |
| src/features/configurations/layout/ConfigSidebar.tsx:64:7 | a | link | 1 |
| src/features/configurations/layout/ConfigSidebar.tsx:95:9 | select | field | 1 |
| src/features/configurations/pages/Atalhos/components/AtalhoModal.tsx:160:13 | button | button | 1 |
| src/features/configurations/pages/Atalhos/components/AtalhoModal.tsx:226:11 | button | button | 1 |
| src/features/configurations/pages/Atalhos/components/AtalhoModal.tsx:244:11 | input | field | 1 |
| src/features/configurations/pages/Atalhos/index.tsx:269:9 | SelectUnico | field | 1 |
| src/features/configurations/pages/Atalhos/index.tsx:336:15 | div | button | 1 |
| src/features/configurations/pages/Atalhos/PreviewConteudo.tsx:69:7 | a | link | 1 |
| src/features/configurations/pages/Automacoes/components/EncerramentoCard.tsx:63:17 | Select | field | 2 |
| src/features/configurations/pages/Automacoes/components/PalavrasChave.tsx:39:11 | button | button | 2 |
| src/features/configurations/pages/CamposPersonalizados/components/CampoModal.tsx:109:9 | input | field | 2 |
| src/features/configurations/pages/CamposPersonalizados/components/CampoModal.tsx:134:13 | button | button | 2 |
| src/features/configurations/pages/CamposPersonalizados/index.tsx:159:9 | SelectUnico | field | 2 |
| src/features/configurations/pages/CamposPersonalizados/index.tsx:248:15 | button | button | 2 |
| src/features/configurations/pages/CamposPersonalizados/index.tsx:259:15 | button | button | 2 |
| src/features/configurations/pages/Canais/components/ConectarCanalModal.tsx:109:13 | button | button | 2 |
| src/features/configurations/pages/Canais/components/ConectarCanalModal.tsx:126:15 | button | button | 2 |
| src/features/configurations/pages/Canais/index.tsx:107:9 | SelectUnico | field | 2 |
| src/features/configurations/pages/Canais/index.tsx:181:13 | div | button | 2 |
| src/features/configurations/pages/Departamentos/components/DistribuicaoCard.tsx:129:27 | button | button | 1 |
| src/features/configurations/pages/Departamentos/components/EquipeCard.tsx:120:21 | button | button | 1 |
| src/features/configurations/pages/Departamentos/components/EquipeCard.tsx:80:13 | button | button | 1 |
| src/features/configurations/pages/Departamentos/components/NovoDepartamentoModal.tsx:253:15 | button | button | 2 |
| src/features/configurations/pages/Departamentos/index.tsx:129:13 | div | button | 2 |
| src/features/configurations/pages/Horarios/components/ExcecaoModal.tsx:140:11 | select | field | 1 |
| src/features/configurations/pages/Horarios/components/FeriadoModal.tsx:206:11 | input | field | 1 |
| src/features/configurations/pages/Horarios/components/FeriadoModal.tsx:215:11 | input | field | 1 |
| src/features/configurations/pages/Horarios/components/FeriadoModal.tsx:245:13 | input | field | 1 |
| src/features/configurations/pages/Horarios/components/FeriadoModal.tsx:254:13 | input | field | 1 |
| src/features/configurations/pages/Horarios/components/FeriadoModal.tsx:271:11 | Select | field | 1 |
| src/features/configurations/pages/Integracoes/components/IntegracaoModal.tsx:205:13 | button | button | 1 |
| src/features/configurations/pages/Integracoes/components/IntegracaoModal.tsx:283:19 | input | field | 1 |
| src/features/configurations/pages/Integracoes/components/IntegracaoModal.tsx:316:19 | InputSkeleton | field | 1 |
| src/features/configurations/pages/Integracoes/components/IntegracaoModal.tsx:317:19 | InputSkeleton | field | 1 |
| src/features/configurations/pages/Integracoes/index.tsx:259:13 | button | button | 1 |
| src/features/configurations/pages/Integracoes/index.tsx:373:17 | button | button | 1 |
| src/features/configurations/pages/Integracoes/index.tsx:391:17 | button | button | 1 |
| src/features/configurations/pages/Mensagens/components/SimuladorFluxo.tsx:206:11 | Select | field | 1 |
| src/features/configurations/pages/Mensagens/components/SimuladorFluxo.tsx:220:11 | Select | field | 1 |
| src/features/configurations/pages/Mensagens/components/SimuladorFluxo.tsx:235:13 | Select | field | 1 |
| src/features/configurations/pages/Mensagens/index.tsx:608:19 | button | button | 1 |
| src/features/configurations/pages/Mensagens/index.tsx:678:19 | InputSkeleton | field | 1 |
| src/features/configurations/pages/Mensagens/index.tsx:680:19 | Select | field | 1 |
| src/features/configurations/pages/Motivos/components/CategoriaCard.tsx:102:7 | div | button | 1 |
| src/features/configurations/pages/Motivos/components/CategoriaCard.tsx:143:9 | button | button | 1 |
| src/features/configurations/pages/Motivos/components/CategoriaCard.tsx:186:15 | button | button | 1 |
| src/features/configurations/pages/Motivos/index.tsx:242:9 | SelectUnico | field | 1 |
| src/features/configurations/pages/Perfis/components/ExcluirPerfilModal.tsx:85:9 | Select | field | 1 |
| src/features/configurations/pages/Perfis/components/NovoPerfilCard.tsx:53:9 | Select | field | 1 |
| src/features/configurations/pages/Perfis/components/PerfilCard.tsx:37:5 | button | button | 1 |
| src/features/configurations/pages/Usuarios/components/AcessoCard.tsx:104:11 | Select | field | 1 |
| src/features/configurations/pages/Usuarios/components/LegacyAccessCard.tsx:55:11 | Select | field | 2 |
| src/features/configurations/pages/Usuarios/index.tsx:277:9 | SelectUnico | field | 2 |
| src/features/configurations/pages/Usuarios/index.tsx:344:13 | div | button | 2 |
| src/features/configurations/pages/Usuarios/UsuarioNovo.tsx:302:21 | Select | field | 1 |
| src/features/conversation-queue/components/TodosQueueSurface/index.tsx:136:9 | h2 | heading | 1 |
| src/features/conversation-queue/components/TodosQueueSurface/TodosQueueSurface.test.tsx:60:32 | button | button | 0 |
| src/features/conversation-queue/components/TodosQueueSurface/TodosQueueSurface.test.tsx:87:11 | button | button | 0 |
| src/features/crm/components/ActiveFilterChipBar/index.tsx:706:13 | button | button | 2 |
| src/features/crm/components/ActiveFilterChipBar/index.tsx:723:15 | button | button | 2 |
| src/features/crm/components/ActiveFilterChipBar/index.tsx:739:11 | button | button | 2 |
| src/features/crm/components/ActiveFilterChipBar/index.tsx:776:21 | button | button | 2 |
| src/features/crm/components/ActiveFilterChipBar/index.tsx:811:11 | button | button | 2 |
| src/features/crm/components/BlockingMoveModal/index.tsx:252:13 | h4 | heading | 3 |
| src/features/crm/components/BlockingMoveModal/index.tsx:278:13 | h4 | heading | 3 |
| src/features/crm/components/BulkActionsBar/index.tsx:293:23 | button | menuitem | 2 |
| src/features/crm/components/CardDetail/CustomFieldsSection.tsx:167:19 | input | field | 1 |
| src/features/crm/components/CardDetail/CustomFieldsSection.tsx:175:19 | button | button | 1 |
| src/features/crm/components/CardDetail/CustomFieldsSection.tsx:181:19 | button | button | 1 |
| src/features/crm/components/CardDetail/CustomFieldsSection.tsx:194:21 | button | button | 1 |
| src/features/crm/components/CardDetail/TagsEditor.tsx:544:7 | button | button | 2 |
| src/features/crm/components/CardDetail/TagsEditor.tsx:684:25 | button | button | 2 |
| src/features/crm/components/CardDetail/TagsEditor.tsx:789:13 | button | button | 2 |
| src/features/crm/components/CardDetailSidebar/tabs/CardNoteItem.tsx:134:9 | a | link | 0 |
| src/features/crm/components/CardDetailSidebar/tabs/GeneralTab.tsx:127:13 | button | button | 0 |
| src/features/crm/components/CardDetailSidebar/tabs/GeneralTab.tsx:149:13 | input | field | 0 |
| src/features/crm/components/CardDetailSidebar/tabs/GeneralTab.tsx:186:13 | button | button | 0 |
| src/features/crm/components/CardDetailSidebar/tabs/ProposalListItem.tsx:109:11 | button | button | 1 |
| src/features/crm/components/CardDetailSidebar/tabs/ProposalListItem.tsx:119:11 | button | button | 1 |
| src/features/crm/components/CardDetailSidebar/tabs/ProposalListItem.tsx:132:13 | button | button | 1 |
| src/features/crm/components/CardDetailSidebar/tabs/ProposalListItem.tsx:186:15 | button | button | 1 |
| src/features/crm/components/CardDetailSidebar/tabs/TaskTimelineItem.tsx:119:7 | button | button | 1 |
| src/features/crm/components/CardItem/components/ContextMenu.tsx:185:17 | button | button | 2 |
| src/features/crm/components/CardItem/index.tsx:467:11 | InputMaskCheckBox | field | 2 |
| src/features/crm/components/CardItem/index.tsx:491:9 | h3 | heading | 2 |
| src/features/crm/components/ConfigAccordionRow/index.tsx:60:7 | button | button | 2 |
| src/features/crm/components/ConfigAccordionRow/RowActions.tsx:29:5 | button | button | 2 |
| src/features/crm/components/CRMShell/index.tsx:472:9 | button | button | 2 |
| src/features/crm/components/CustomFieldFilterChips/index.tsx:39:13 | button | button | 0 |
| src/features/crm/components/FilterPopover/ConditionGroup.tsx:144:5 | div | button | 2 |
| src/features/crm/components/FilterPopover/DynamicChipGroup.tsx:214:13 | input | field | 2 |
| src/features/crm/components/FilterPopover/DynamicChipGroup.tsx:239:11 | button | button | 2 |
| src/features/crm/components/FilterPopover/FieldsTab.tsx:225:17 | div | button | 2 |
| src/features/crm/components/FilterPopover/FieldsTab.tsx:249:17 | div | button | 2 |
| src/features/crm/components/FilterPopover/index.tsx:267:9 | button | tab | 2 |
| src/features/crm/components/FilterPopover/index.tsx:279:9 | button | tab | 2 |
| src/features/crm/components/FilterPopover/SavedTab.tsx:193:11 | div | button | 2 |
| src/features/crm/components/FilterPopover/SavedTab.tsx:214:17 | input | field | 2 |
| src/features/crm/components/FilterPopover/SavedTab.tsx:259:19 | button | button | 2 |
| src/features/crm/components/FilterPopover/SavedTab.tsx:291:19 | button | button | 2 |
| src/features/crm/components/KanbanColumn/index.tsx:459:13 | InputMaskCheckBox | field | 2 |
| src/features/crm/components/Modals/CreateCardModal/components/CustomFieldsSection.tsx:76:19 | InputTextArea | field | 3 |
| src/features/crm/components/Modals/CreateCardModal/components/CustomFieldsSection.tsx:83:19 | InputText | field | 3 |
| src/features/crm/components/Modals/CreateCardModal/components/PlanningTab.tsx:42:34 | InputText | field | 0 |
| src/features/crm/components/Modals/CreateCardModal/components/PlanningTab.tsx:53:34 | InputText | field | 0 |
| src/features/crm/components/Modals/CreateCardModal/components/PlanningTab.tsx:69:17 | button | button | 0 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:1136:25 | button | tab | 3 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:1192:27 | h3 | heading | 3 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:1316:31 | button | button | 3 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:1500:29 | input | field | 3 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:1609:31 | button | button | 3 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:1748:27 | input | field | 3 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:184:3 | button | button | 3 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:404:13 | button | button | 3 |
| src/features/crm/components/Modals/CreateCardModal/index.tsx:424:11 | button | button | 3 |
| src/features/crm/components/Modals/CreateFunnelModal/components/ConditionValueInput.tsx:161:9 | InputText | field | 0 |
| src/features/crm/components/Modals/CreateFunnelModal/components/ConditionValueInput.tsx:93:12 | InputSkeleton | field | 0 |
| src/features/crm/components/Modals/CreateFunnelModal/components/FunnelUsersEditor/index.tsx:72:15 | MultiSelectSystem | field | 0 |
| src/features/crm/components/Modals/CreateFunnelModal/components/SelectWithMultiSupport.tsx:47:7 | MultiSelectSystem | field | 0 |
| src/features/crm/components/Modals/CreateFunnelModal/components/SelectWithMultiSupport.tsx:71:7 | SelectSystem | field | 0 |
| src/features/crm/components/Modals/ManagePipelinesModal/DuplicatePipelineModal.tsx:49:11 | input | field | 2 |
| src/features/crm/components/Modals/ManagePipelinesModal/DuplicatePipelineModal.tsx:70:11 | input | field | 2 |
| src/features/crm/components/Modals/ManagePipelinesModal/index.tsx:287:19 | FilterBtn | tab | 2 |
| src/features/crm/components/Modals/ManagePipelinesModal/PermissionsModal/index.tsx:194:13 | Title | heading | 2 |
| src/features/crm/components/Modals/NewPipelineModal/CustomSelect.tsx:215:9 | Button | button | 2 |
| src/features/crm/components/Modals/NewPipelineModal/index.tsx:407:13 | Title | heading | 2 |
| src/features/crm/components/Modals/NewPipelineModal/index.tsx:428:17 | StepItem | tab | 2 |
| src/features/crm/components/Modals/ProposalLinkModal/index.tsx:126:13 | button | button | 1 |
| src/features/crm/components/Modals/ProposalSendModal/index.tsx:842:19 | textarea | field | 1 |
| src/features/crm/components/Modals/ProposalUpsertModal/index.tsx:1003:27 | button | button | 4 |
| src/features/crm/components/Modals/ProposalUpsertModal/index.tsx:1021:21 | input | field | 4 |
| src/features/crm/components/Modals/ProposalUpsertModal/index.tsx:1292:33 | input | field | 4 |
| src/features/crm/components/Modals/ProposalUpsertModal/index.tsx:644:27 | button | button | 4 |
| src/features/crm/components/Modals/ProposalUpsertModal/index.tsx:725:23 | input | field | 4 |
| src/features/crm/components/Modals/ProposalUpsertModal/index.tsx:967:27 | input | field | 4 |
| src/features/crm/components/Modals/ReportModal/index.tsx:136:23 | InputCheckbox | field | 0 |
| src/features/crm/components/Modals/StageModal/components/ColorPicker.tsx:102:2 | div | button | 0 |
| src/features/crm/components/Modals/StageModal/components/ConfirmMigrateModal.tsx:73:21 | select | field | 0 |
| src/features/crm/components/PipelineSelector/index.tsx:135:7 | button | button | 2 |
| src/features/crm/components/PipelineSelector/index.tsx:392:5 | div | button | 2 |
| src/features/crm/components/ReportCardWithHistory/index.tsx:32:11 | h3 | heading | 0 |
| src/features/crm/components/Selects/ContactSelect/index.tsx:171:9 | input | field | 3 |
| src/features/crm/components/Selects/ContactSelect/index.tsx:372:7 | SelectSystem | field | 3 |
| src/features/crm/components/StageHistoryTimeline/index.tsx:72:21 | h5 | heading | 0 |
| src/features/crm/components/ViewsSelector/index.tsx:190:7 | button | button | 2 |
| src/features/crm/components/ViewsSelector/index.tsx:219:19 | div | menuitem | 2 |
| src/features/crm/components/ViewsSelector/index.tsx:247:19 | div | menuitem | 2 |
| src/features/crm/dashboard/components/DashboardFunnelChip/index.tsx:113:3 | button | button | 0 |
| src/features/crm/dashboard/components/DashboardPeriodChip/index.tsx:108:15 | button | button | 0 |
| src/features/crm/dashboard/components/DashboardPeriodChip/index.tsx:133:17 | input | field | 0 |
| src/features/crm/dashboard/components/DashboardPeriodChip/index.tsx:143:17 | input | field | 0 |
| src/features/crm/dashboard/CrmDashboardEmptyState.tsx:30:7 | h3 | heading | 0 |
| src/features/crm/dashboard/sections/AgentRankingCard.tsx:36:13 | button | tab | 0 |
| src/features/crm/dashboard/sections/DashboardHeader.tsx:50:9 | h1 | heading | 0 |
| src/features/crm/pages/components/CrmSettingsPageState.tsx:33:7 | h1 | heading | 4 |
| src/features/crm/pages/CrmSettingsCatalogPage/components/CatalogImportModal/index.tsx:437:21 | input | field | 1 |
| src/features/crm/pages/CrmSettingsCatalogPage/components/CatalogItemModal.tsx:178:15 | SelectSystem | field | 5 |
| src/features/crm/pages/CrmSettingsCatalogPage/components/CatalogTable.tsx:86:17 | button | button | 5 |
| src/features/crm/pages/CrmSettingsCatalogPage/components/CatalogTable.tsx:96:17 | button | button | 5 |
| src/features/crm/pages/CrmSettingsCompanyPage/index.tsx:157:17 | button | button | 1 |
| src/features/crm/pages/CrmSettingsCompanyPage/index.tsx:172:17 | input | field | 1 |
| src/features/crm/pages/CrmSettingsCompanyPage/index.tsx:235:19 | input | field | 1 |
| src/features/crm/pages/CrmSettingsCompanyPage/index.tsx:245:19 | input | field | 1 |
| src/features/crm/pages/CrmSettingsCompanyPage/index.tsx:258:19 | input | field | 1 |
| src/features/crm/pages/CrmSettingsCompanyPage/index.tsx:269:19 | input | field | 1 |
| src/features/crm/pages/CrmSettingsCompanyPage/index.tsx:296:17 | textarea | field | 1 |
| src/features/crm/pages/CrmSettingsPage/index.tsx:115:17 | a | link | 6 |
| src/features/crm/pages/CrmSettingsPdfTemplatePage/index.tsx:204:19 | input | field | 1 |
| src/features/crm/pages/CrmSettingsShippingPage/components/CarrierModal.tsx:117:13 | input | field | 1 |
| src/features/crm/pages/CrmSettingsShippingPage/components/ShippingTypeRow.tsx:287:11 | SelectSystem | field | 1 |
| src/features/crm/stage-editor/RequiredFieldsPanel.tsx:405:21 | input | field | 2 |
| src/features/crm/stage-editor/RequiredFieldsPanel.tsx:445:21 | input | field | 2 |
| src/features/crm/stage-editor/StageEditorMasterModal.tsx:235:13 | h2 | heading | 2 |
| src/features/crm/stage-editor/StageEditorMasterModal.tsx:268:11 | Tab | tab | 2 |
| src/features/crm/stage-editor/StageEditorMasterModal.tsx:479:9 | Input | field | 2 |
| src/features/crm/stage-editor/StageEditorMasterModal.tsx:645:13 | input | field | 2 |
| src/features/crm/stage-editor/TaskEditForm.tsx:331:11 | input | field | 2 |
| src/features/crm/stage-editor/TaskEditForm.tsx:364:7 | SelectTrigger | field | 2 |
| src/features/crm/stage-editor/TaskEditForm.tsx:387:5 | SelectWrap | field | 2 |
| src/features/crm/stage-editor/TaskEditForm.tsx:390:9 | SelectPanel | field | 2 |
| src/features/crm/stage-editor/TaskEditForm.tsx:391:11 | SelectList | field | 2 |
| src/features/dashboard/components/DashboardFilters/index.tsx:54:11 | InputDate | field | 1 |
| src/features/dashboard/components/DashboardFilters/index.tsx:65:11 | InputDate | field | 1 |
| src/features/groups/conversations/components/GroupConversationCard/index.tsx:204:7 | button | button | 1 |
| src/features/groups/conversations/components/GroupConversationCard/index.tsx:396:11 | InputMaskCheckBox | field | 1 |
| src/features/groups/conversations/components/GroupConversationColumn/GroupConversationColumn.bulkArchiveConfirm.test.tsx:126:11 | button | button | 0 |
| src/features/groups/conversations/components/GroupConversationColumn/GroupConversationColumn.bulkArchiveConfirm.test.tsx:22:5 | button | button | 0 |
| src/features/groups/conversations/components/GroupConversationColumn/GroupConversationColumn.filterTrail.test.tsx:13:5 | button | button | 0 |
| src/features/groups/conversations/components/GroupConversationColumn/GroupConversationColumn.test.tsx:226:13 | button | button | 0 |
| src/features/groups/conversations/components/GroupConversationColumn/GroupConversationColumn.test.tsx:234:11 | button | button | 0 |
| src/features/groups/conversations/components/GroupConversationColumn/GroupConversationColumn.test.tsx:96:5 | button | button | 0 |
| src/features/groups/conversations/components/GroupConversationDetails/GroupParticipantsList.tsx:94:15 | button | button | 1 |
| src/features/groups/conversations/components/GroupConversationDetails/GroupScheduledMessagesView.tsx:157:13 | button | button | 1 |
| src/features/groups/conversations/components/GroupConversationDetails/index.tsx:1446:15 | IdName | heading | 1 |
| src/features/groups/conversations/components/GroupConversationDetails/index.tsx:1753:17 | h3 | heading | 1 |
| src/features/groups/conversations/components/GroupConversationEmptyPane/index.tsx:146:3 | ButtonIconAction | button | 1 |
| src/features/groups/conversations/components/GroupConversationEmptyPane/index.tsx:360:13 | ButtonIconAction | button | 1 |
| src/features/groups/conversations/components/GroupConversationEmptyPane/index.tsx:96:3 | ButtonIconAction | button | 1 |
| src/features/groups/conversations/components/GroupConversationHeader/GroupConversationHeader.test.tsx:26:5 | button | button | 0 |
| src/features/groups/conversations/components/GroupConversationHeader/index.tsx:366:9 | WrapperLeftContent | button | 1 |
| src/features/groups/conversations/components/GroupConversationHeader/index.tsx:380:11 | h2 | heading | 1 |
| src/features/groups/conversations/components/GroupConversationList/GroupConversationList.test.tsx:69:9 | button | button | 0 |
| src/features/groups/timeline/components/GroupConversationTimeline/GroupConversationTimeline.composer.integration.test.tsx:259:7 | button | button | 0 |
| src/features/groups/timeline/components/GroupConversationTimeline/GroupConversationTimeline.composer.integration.test.tsx:292:49 | button | button | 0 |
| src/features/groups/timeline/components/GroupConversationTimeline/GroupConversationTimeline.quoteAudio.test.tsx:64:49 | button | button | 0 |
| src/features/groups/timeline/components/GroupConversationTimeline/GroupConversationTimeline.test.tsx:98:49 | button | button | 0 |
| src/features/groups/timeline/components/GroupConversationTimeline/GroupConversationTimeline.transcription.test.tsx:75:49 | button | button | 0 |
| src/features/groups/timeline/components/GroupConversationTimeline/GroupConversationTimeline.typingRenders.test.tsx:200:49 | button | button | 0 |
| src/features/groups/timeline/components/GroupConversationTimeline/index.tsx:1291:19 | InputMaskCheckBox | field | 1 |
| src/features/groups/timeline/components/GroupConversationTimeline/index.tsx:274:5 | button | button | 1 |
| src/features/groups/timeline/components/GroupMessageComposer/GroupAttachmentMenu.tsx:108:9 | input | field | 1 |
| src/features/groups/timeline/components/GroupMessageComposer/GroupMessageComposer.clipboardDrop.test.tsx:47:9 | textarea | field | 0 |
| src/features/groups/timeline/components/GroupMessageComposer/GroupMessageComposer.emojiLibrary.test.tsx:82:25 | textarea | field | 0 |
| src/features/groups/timeline/components/GroupMessageComposer/GroupMessageComposer.test.tsx:173:25 | textarea | field | 0 |
| src/features/groups/timeline/components/GroupReactionControls/index.tsx:790:13 | button | button | 1 |
| src/features/groups/timeline/components/GroupReactionControls/index.tsx:839:17 | button | button | 1 |
| src/features/groups/timeline/components/GroupReactionControls/index.tsx:847:19 | button | button | 1 |
| src/features/groups/timeline/components/GroupReactionControls/index.tsx:866:25 | button | button | 1 |
| src/features/help-assistant/components/GuideCard/index.tsx:166:13 | h3 | heading | 0 |
| src/features/help-assistant/components/GuideCard/index.tsx:253:13 | h4 | heading | 0 |
| src/features/help-assistant/components/GuideCard/index.tsx:267:15 | ButtonIconAction | button | 0 |
| src/features/help-assistant/components/GuideCard/index.tsx:317:17 | h4 | heading | 0 |
| src/features/help-assistant/components/GuideCard/index.tsx:358:21 | ButtonIconAction | button | 0 |
| src/features/help-assistant/components/GuideDiscovery/index.tsx:123:5 | ButtonIconAction | button | 0 |
| src/features/help-assistant/components/GuideDiscovery/index.tsx:174:15 | h4 | heading | 0 |
| src/features/help-assistant/components/GuideDiscovery/index.tsx:209:15 | ButtonIconAction | button | 0 |
| src/features/help-assistant/components/GuideDiscovery/index.tsx:246:11 | ButtonIconAction | button | 0 |
| src/features/help-assistant/components/HelpAssistantWidget/index.tsx:473:17 | h3 | heading | 0 |
| src/features/help-assistant/components/HelpAssistantWidget/index.tsx:502:23 | ButtonIconAction | button | 0 |
| src/features/help-assistant/components/HelpAssistantWidget/index.tsx:524:17 | h3 | heading | 0 |
| src/features/help-assistant/components/HelpAssistantWidget/index.tsx:680:29 | h4 | heading | 0 |
| src/features/help-assistant/components/HelpAssistantWidget/index.tsx:704:31 | ButtonIconAction | button | 0 |
| src/features/help-assistant/components/HelpAssistantWidget/index.tsx:720:23 | ButtonIconAction | button | 0 |
| src/features/help-assistant/components/HelpAssistantWidget/index.tsx:765:31 | a | link | 0 |
| src/features/help-assistant/components/HelpAssistantWidget/index.tsx:829:29 | ButtonIconAction | button | 0 |
| src/features/notifications/components/NotificationDropdown/index.tsx:159:17 | button | button | 0 |
| src/features/notifications/components/NotificationToast/index.tsx:106:9 | button | button | 0 |
| src/features/notifications/pages/NotificationCenterPage/index.tsx:193:17 | button | button | 1 |
| src/features/notifications/pages/NotificationCenterPage/index.tsx:218:17 | button | button | 1 |
| src/features/notifications/pages/NotificationCenterPage/index.tsx:75:9 | button | button | 1 |
| src/features/omnichannel/components/HoldBadge/index.tsx:27:5 | ButtonWithIcon | button | 1 |
| src/features/omnichannel/components/UploadingMessageItem/index.tsx:160:5 | ButtonWithIcon | button | 1 |
| src/features/omnichannel/components/UploadingMessageItem/index.tsx:171:5 | ButtonWithIcon | button | 1 |
| src/features/onboarding-trial/components/Passo1Conectar.tsx:1178:7 | h1 | heading | 0 |
| src/features/onboarding-trial/components/Passo1Conectar.tsx:706:13 | input | field | 0 |
| src/features/onboarding-trial/components/Passo1Conectar.tsx:756:13 | button | button | 0 |
| src/features/onboarding-trial/components/Passo1Conectar.tsx:904:11 | input | field | 0 |
| src/features/onboarding-trial/components/Passo1Conectar.tsx:908:11 | input | field | 0 |
| src/features/onboarding-trial/components/Passo1Conectar.tsx:948:11 | input | field | 0 |
| src/features/onboarding-trial/components/Passo1Conectar.tsx:953:13 | input | field | 0 |
| src/features/onboarding-trial/components/Passo1Conectar.tsx:992:11 | button | button | 0 |
| src/features/onboarding-trial/components/PopupPerguntas.tsx:167:9 | h2 | heading | 0 |
| src/features/onboarding-trial/components/PopupPerguntas.tsx:176:13 | SelectUnico | field | 0 |
| src/features/onboarding-trial/components/PopupPerguntas.tsx:198:15 | button | button | 0 |
| src/features/onboarding/components/bot/BotTypeSelector.tsx:14:9 | button | button | 0 |
| src/features/onboarding/components/CustomHoursEditor.tsx:38:15 | button | button | 0 |
| src/features/onboarding/components/CustomHoursEditor.tsx:55:19 | input | field | 0 |
| src/features/onboarding/components/CustomHoursEditor.tsx:59:19 | input | field | 0 |
| src/features/onboarding/components/dept/DeptCard.tsx:58:15 | button | button | 0 |
| src/features/onboarding/components/PageNav.tsx:37:11 | button | button | 0 |
| src/features/onboarding/components/Stepper.tsx:67:17 | button | button | 0 |
| src/features/onboarding/components/steps/Step1Pain.tsx:194:15 | button | button | 0 |
| src/features/onboarding/components/steps/Step1Pain.tsx:227:13 | button | button | 0 |
| src/features/onboarding/components/steps/Step1Pain.tsx:269:13 | input | field | 0 |
| src/features/onboarding/components/steps/Step1Pain.tsx:282:13 | input | field | 0 |
| src/features/onboarding/components/steps/Step2Empresa.tsx:294:15 | button | button | 0 |
| src/features/onboarding/components/steps/Step2Empresa.tsx:353:15 | textarea | field | 0 |
| src/features/onboarding/components/steps/Step2Empresa.tsx:398:13 | select | field | 0 |
| src/features/onboarding/components/steps/Step2Empresa.tsx:431:19 | button | button | 0 |
| src/features/onboarding/components/steps/Step2Empresa.tsx:461:25 | button | button | 0 |
| src/features/onboarding/components/steps/Step3Time.tsx:141:15 | input | field | 0 |
| src/features/onboarding/components/steps/Step3Time.tsx:162:13 | input | field | 0 |
| src/features/onboarding/components/steps/Step3Time.tsx:185:19 | button | button | 0 |
| src/features/onboarding/components/steps/Step3Time.tsx:221:19 | button | button | 0 |
| src/features/onboarding/components/steps/Step3Time.tsx:317:21 | button | button | 0 |
| src/features/onboarding/components/steps/Step3Time.tsx:320:21 | button | button | 0 |
| src/features/onboarding/components/steps/Step4IA.tsx:593:21 | button | button | 0 |
| src/features/onboarding/components/steps/Step4IA.tsx:64:13 | select | field | 0 |
| src/features/onboarding/components/steps/Step4IA.tsx:660:21 | button | button | 0 |
| src/features/onboarding/components/steps/Step4IA.tsx:671:21 | input | field | 0 |
| src/features/onboarding/components/steps/Step4IA.tsx:695:29 | input | field | 0 |
| src/features/onboarding/components/steps/Step4IA.tsx:790:23 | button | button | 0 |
| src/features/onboarding/components/steps/Step4IA.tsx:846:21 | button | button | 0 |
| src/features/onboarding/components/steps/Step6Conectar.tsx:232:13 | button | button | 0 |
| src/features/onboarding/components/steps/Step6Conectar.tsx:330:11 | input | field | 0 |
| src/features/onboarding/components/steps/Step6Conectar.tsx:334:11 | input | field | 0 |
| src/features/onboarding/components/steps/Step6Conectar.tsx:374:11 | input | field | 0 |
| src/features/onboarding/components/steps/Step6Conectar.tsx:379:13 | input | field | 0 |
| src/features/onboarding/components/steps/Step6Conectar.tsx:418:11 | button | button | 0 |
| src/features/onboarding/components/steps/Step6Conectar.tsx:594:7 | h1 | heading | 0 |
| src/features/onboarding/components/WhatsAppEditor.tsx:31:11 | button | button | 0 |
| src/features/onboarding/components/WhatsAppEditor.tsx:43:7 | textarea | field | 0 |
| src/features/profile/components/CombinedProfileCard/index.tsx:258:19 | InputText | field | 1 |
| src/features/profile/components/CombinedProfileCard/index.tsx:286:23 | InputText | field | 1 |
| src/features/profile/components/CombinedProfileCard/index.tsx:297:23 | button | button | 1 |
| src/features/profile/components/CombinedProfileCard/index.tsx:322:19 | InputPhoneMask | field | 1 |
| src/features/profile/components/CombinedProfileCard/index.tsx:330:19 | button | button | 1 |
| src/features/profile/components/CombinedProfileCard/index.tsx:370:13 | button | button | 1 |
| src/features/profile/components/CombinedProfileCard/index.tsx:478:13 | button | button | 1 |
| src/features/profile/components/PersonalDataCard/index.tsx:157:17 | button | button | 0 |
| src/features/profile/components/PersonalDataCard/index.tsx:186:11 | button | button | 0 |
| src/features/profile/components/ProfileSummaryCard/index.tsx:120:11 | input | field | 1 |
| src/features/profile/components/ProfileSummaryCard/index.tsx:124:9 | h2 | heading | 1 |
| src/features/profile/components/SecurityCard/index.tsx:173:11 | button | button | 0 |
| src/features/reports/components/ReportsFiltersPanel/index.tsx:148:11 | InputDate | field | 0 |
| src/features/reports/components/ReportsFiltersPanel/index.tsx:162:11 | InputDate | field | 0 |
| src/features/reports/components/ReportsPagination/index.tsx:142:13 | a | link | 1 |
| src/features/reports/components/ReportsPagination/index.tsx:169:15 | a | link | 1 |
| src/features/reports/components/ReportsTable/ColumnFilter.tsx:101:17 | button | button | 1 |
| src/features/reports/components/ReportsTable/ColumnFilter.tsx:121:9 | input | field | 1 |
| src/features/reports/components/ReportsTable/ColumnFilter.tsx:86:9 | button | button | 1 |
| src/features/reports/components/ReportsToolbar/index.tsx:174:25 | input | field | 1 |
| src/features/reports/components/ReportsToolbar/index.tsx:352:15 | InputDate | field | 1 |
| src/features/reports/components/ReportsToolbar/index.tsx:383:15 | InputDate | field | 1 |
| src/features/tasks/components/CalendarView/index.tsx:339:19 | button | button | 1 |
| src/features/tasks/components/TaskDrawer/index.tsx:658:23 | InputTime | field | 4 |
| src/features/tasks/components/TaskDrawer/index.tsx:677:23 | InputTime | field | 4 |
| src/features/tasks/components/TaskList/index.tsx:216:11 | button | button | 1 |
| src/features/tasks/components/TaskList/index.tsx:243:23 | InputCheckbox | field | 1 |
| src/features/tasks/components/TaskList/index.tsx:248:23 | button | button | 1 |
| src/features/tasks/components/TaskList/TaskList.groupCompatibility.test.tsx:20:5 | input | field | 0 |
| src/features/tasks/pages/TasksPage/components/TaskFilters/index.tsx:124:13 | InputDate | field | 1 |
| src/features/tasks/pages/TasksPage/components/TaskFilters/index.tsx:133:13 | InputDate | field | 1 |
| src/features/tour/components/TourModal.tsx:48:9 | h2 | heading | 2 |
| src/features/tour/components/TourModal.tsx:64:13 | button | button | 2 |
| src/features/tour/components/TourModal.tsx:72:11 | button | button | 2 |
| src/features/tour/components/TourOverlay.tsx:162:9 | h3 | heading | 2 |
| src/features/tour/components/TourOverlay.tsx:181:13 | button | button | 2 |
| src/features/tour/components/TourOverlay.tsx:189:15 | button | button | 2 |
| src/features/tour/components/TourOverlay.tsx:197:13 | button | button | 2 |
| src/features/track/components/TrackAttendanceOriginBadge/index.tsx:62:5 | button | button | 1 |
| src/features/track/components/TrackButton/index.tsx:50:7 | button | button | 3 |
| src/features/track/components/TrackCoverageCard/index.tsx:229:9 | button | button | 2 |
| src/features/track/components/TrackModuleHeader/index.tsx:61:7 | h1 | heading | 3 |
| src/features/track/components/TrackNoReplyRankCard/index.tsx:99:11 | button | button | 2 |
| src/features/track/components/TrackOriginContactRow/index.tsx:84:5 | ButtonIconAction | button | 2 |
| src/features/track/components/TrackOriginContactsDrawer/index.tsx:196:15 | DialogTitle | heading | 2 |
| src/features/track/components/TrackOriginContactsDrawer/index.tsx:259:11 | ButtonIconAction | button | 2 |
| src/features/track/components/TrackOriginsTable/index.tsx:617:19 | div | button | 3 |
| src/features/track/components/TrackOriginsTable/index.tsx:765:7 | button | button | 3 |
| src/features/track/components/TrackQueueCard/index.tsx:136:11 | button | button | 2 |
| src/features/track/components/TrackQueueDrawer/index.tsx:141:5 | button | button | 2 |
| src/features/track/components/TrackQueueRow/index.tsx:90:5 | div | button | 2 |
| src/features/track/components/TrackUpsellState/index.tsx:122:9 | h2 | heading | 2 |

## Compatibilidade das fontes publicadas

O envelope conserva sourceRevisions, herdado do snapshot aprovado anterior. O gate aceita uma revisão histórica apenas quando a anotação inteira de fonte (passo, lado, SHA, arquivo, linha e alvo) já existe, idêntica, na mesma página publicada. Fonte nova, retarget ou revisão desconhecida continua exigindo o SHA atual. Texto canônico e existência do alvo continuam obrigatórios. As fontes dos artigos não foram reescritas para fingir uma revisão nova.

## Provas

Base docs: `372b7c7a2db3fc750d5e7fb4295bf21616cc0d29`. Todas as execuções passaram pela fila global `mac-build-control run --host mac --wait --cwd "$PWD" -- <cmd>`, sem infra paga, deploy ou alterações no front.

### Rodada final — OWN

Job `50560c665406451d` / pueue `13058`: command rc=0, wrapper rc=0, source_before=source_after, cleanup `clean`. Execução em `pilot/` do worktree; snapshot v2 já instalado antes dos testes.

| Comando/teste | rc |
| --- | ---: |
| public-submit-source-revisions | 0 |
| mcp/product-map-m547.test.mjs | 0 |
| mcp/product-map-r2.test.mjs | 0 |
| mcp/product-map-r3.test.mjs | 0 |
| mcp/product-map-rework.test.mjs | 0 |
| mcp/product-map-v2.test.mjs | 0 |
| mcp/product-map.test.mjs | 0 |
| mcp/public-submit-baseline.test.mjs | 0 |
| mcp/public-submit-gate.test.mjs | 0 |
| mcp/public-submit-marker.test.mjs | 0 |
| content:validate | 0 |

`product-map-v2` cobre todos os papéis, origem/coluna, ocorrência repetida na mesma linha, nomes condicionais, sem nome, sem rota, alias/reexport, configurações lazy com URL legada, exclusão de wrappers e escopo Dialog herdado pelo uso JSX. O teste de revisões cobre recusa de SHA desconhecido, histórico abreviado, página nova, lado incorreto e alteração de alvo/arquivo/linha. `product-map-r3` prova que avançar o SHA mantém as revisões aprovadas anteriores e não altera o inventário.

### Guide-proof — OWN + REUSED

A primeira execução local falhou em uma navegação de fixture interrompida por `chrome-error://chromewebdata/` (job `decced5f11f84668`, rc=1). O re-test no worktree atual passou com rc=0 no job `08a64b03ab894c3b`, com source_before=source_after e cleanup clean. Essa rodada tentou preparar um baseline com archive relativo a pilot, mas o setup falhou e o teste rodou no worktree atual; ela NÃO é usada como prova de origem.

O baseline foi de fato executado depois, no job `f5a8dc9e28b647fc`, a partir de `git -C <repo-root> archive --prefix=origin/ 372b7c7a2db3fc750d5e7fb4295bf21616cc0d29`, com checagem do arquivo antes de executar: `node mcp/guide-proof-rework.test.mjs` rc=0. O rc agregado desse job foi 1 por causa das duas falhas editoriais de pin de fonte, corrigidas e revalidadas na rodada final acima; não foi falha do browser de origem.

O rc=0 do guide-proof atual é REUSED: teste, runner, roteiros, helpers visuais, env-compat e product-actions permanecem byte a byte iguais à origem (`git diff --exit-code` focado confirmou). A mudança posterior foi no gate editorial/metadados do mapa, que não são inputs do guide-proof. Não houve aumento de timeout, relaxamento de assertion nem crawl autenticado.

### Identidade dos artefatos

Inventário imutável produzido no job f5a8dc9e28b647fc: sha256 de JSON.stringify(manifest) = `4c84b48d128dfaa9f7a9bc87c2b64d0d385f8cd94adabe689bbbbce77d72742a`. O mesmo inventário foi reaproveitado, com SHAs de entrada e código extrator inalterados; somente sourceRevisions foi acrescentado ao envelope.

Fingerprint da rodada final: `c176cbe6e6deeccc0799e2d252c80d2a56816e7b03117447c63fb5b5ef8d6919`. A lista abaixo registra os bytes efetivamente testados (o relatório apenas recebeu os resultados depois da execução):

```text
85d181a33628b0f050d1c0df8e9e3c86edd087340b8bd49765f30cd5686042eb  lib/product-map.mjs
7539b9b08e14be0a39e55d611b636e066c9125fa4ce00680cfc5448f89dd575e  lib/product-map-query.mjs
238ec4c0ad776396002ee0da8a0d423eabddeafa196b25146b0d811381549c50  mcp/front-screen-facts.mjs
f98c5ab2a4c4dd802cfa99d3b8b18318c371b58660b37848c34203dc1bb2f06b  mcp/product-map-v2.test.mjs
8f7d606ac124e417827dc9d567718c1959688e94d254490e62789cf11fc30e30  mcp/product-map-r3.test.mjs
12c0c5f70e8bb481466613b75143ce83146b04b0dd61fa747fc32c4c04000e7b  mcp/public-submit-gate.mjs
44ce9770efd2177db02d92a881b7ad97237c3583b348a34c58e0539338484c65  mcp/public-submit-source-revisions.test.mjs
710a5a5e270027e70c1acce18dd5a8b9208b3d02130d17d7bfeec4e0e4d82768  scripts/product-map.mjs
c7f134eee37bc3ebdf4a51317e1553ab59efa68400fa7d42ff56555d8af46509  product-map/approved.json
```

### Cleanup e escopo

Os receipts dos jobs de teste, geração e comparação registram cleanup clean; archives descartáveis tiveram teardown em finally/trap e foram removidos. Nenhum container, banco ou infraestrutura faturável foi criado. O cache de node_modules existente e os logs/recibos de prova foram preservados. O worktree de desenvolvimento permanece para entrega.

O crawl em runtime, login, runtime.json, junção static/runtime e Fases 1/3/4 não foram executados nesta tarefa.
